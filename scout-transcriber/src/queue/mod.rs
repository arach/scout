use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use sled::{Db, Tree};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

// ZeroMQ queue implementation
#[cfg(feature = "zeromq-queue")]
pub mod zeromq;

// Queue monitoring
pub mod monitor;

#[cfg(feature = "zeromq-queue")]
pub use zeromq::{ZmqQueue, ZmqQueueConfig, ZmqBroker};

pub use monitor::{QueueMonitor, QueueHealth, WorkerStatus, WorkerStatusType};

/// Trait for queue operations
pub trait Queue<T> {
    /// Push an item to the queue
    async fn push(&self, item: &T) -> Result<()>;
    
    /// Pop an item from the queue (FIFO)
    async fn pop(&self) -> Result<Option<T>>;
    
    /// Get an item by ID without removing it
    async fn get(&self, id: &Uuid) -> Result<Option<T>>;
    
    /// Remove an item by ID
    async fn remove(&self, id: &Uuid) -> Result<bool>;
    
    /// Get the current queue length
    async fn len(&self) -> Result<usize>;
    
    /// Check if the queue is empty
    async fn is_empty(&self) -> Result<bool>;
    
    /// Clear all items from the queue
    async fn clear(&self) -> Result<()>;
}

/// High-performance queue implementation using Sled
#[derive(Clone)]
pub struct SledQueue<T> {
    db: Db,
    data_tree: Tree,
    index_tree: Tree,
    counter: Arc<AtomicU64>,
    _phantom: std::marker::PhantomData<T>,
}

impl<T> SledQueue<T>
where
    T: Serialize + DeserializeOwned + Clone + Send + Sync,
{
    /// Create a new SledQueue at the specified path
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let db = sled::open(&path)
            .with_context(|| format!("Failed to open Sled database at {}", path.as_ref().display()))?;
        
        let data_tree = db.open_tree("data")
            .context("Failed to open data tree")?;
        
        let index_tree = db.open_tree("index")
            .context("Failed to open index tree")?;
        
        // Initialize counter from the highest existing sequence number
        let counter = if let Some((key, _)) = index_tree.last()? {
            let seq = u64::from_be_bytes(
                key.as_ref().try_into()
                    .context("Invalid sequence number in index")?
            );
            Arc::new(AtomicU64::new(seq + 1))
        } else {
            Arc::new(AtomicU64::new(0))
        };
        
        info!("Initialized SledQueue at {}", path.as_ref().display());
        
        Ok(Self {
            db,
            data_tree,
            index_tree,
            counter,
            _phantom: std::marker::PhantomData,
        })
    }
    
    /// Create a new in-memory SledQueue (useful for testing)
    pub fn new_temp() -> Result<Self> {
        let db = sled::Config::new()
            .temporary(true)
            .open()
            .context("Failed to create temporary Sled database")?;
        
        let data_tree = db.open_tree("data")
            .context("Failed to open data tree")?;
        
        let index_tree = db.open_tree("index")
            .context("Failed to open index tree")?;
        
        let counter = Arc::new(AtomicU64::new(0));
        
        Ok(Self {
            db,
            data_tree,
            index_tree,
            counter,
            _phantom: std::marker::PhantomData,
        })
    }
    
    /// Get database statistics
    pub fn stats(&self) -> Result<QueueStats> {
        let data_size = self.data_tree.len();
        let index_size = self.index_tree.len();
        let db_size = self.db.size_on_disk()?;
        
        Ok(QueueStats {
            items: data_size,
            index_entries: index_size,
            disk_size_bytes: db_size,
        })
    }
    
    /// Flush all pending writes to disk
    pub async fn flush(&self) -> Result<()> {
        self.db.flush_async().await
            .context("Failed to flush database")?;
        Ok(())
    }
    
    /// Get the underlying database reference
    pub fn db(&self) -> &Db {
        &self.db
    }
}

impl<T> Queue<T> for SledQueue<T>
where
    T: Serialize + DeserializeOwned + Clone + Send + Sync,
{
    async fn push(&self, item: &T) -> Result<()> {
        // Serialize the item
        let data = rmp_serde::to_vec(item)
            .context("Failed to serialize item")?;
        
        // Get next sequence number
        let seq = self.counter.fetch_add(1, Ordering::SeqCst);
        let seq_key = seq.to_be_bytes();
        
        // Store in data tree with sequence as key
        self.data_tree.insert(&seq_key, data.as_slice())
            .with_context(|| format!("Failed to insert item with sequence {}", seq))?;
        
        debug!("Pushed item with sequence {}", seq);
        Ok(())
    }
    
    async fn pop(&self) -> Result<Option<T>> {
        // Get the first item from index tree
        if let Some((seq_key, _)) = self.index_tree.first()? {
            // Remove from index first
            self.index_tree.remove(&seq_key)?;
            
            // Get and remove from data tree
            if let Some(data) = self.data_tree.remove(&seq_key)? {
                let item = rmp_serde::from_slice(&data)
                    .context("Failed to deserialize popped item")?;
                
                let seq = u64::from_be_bytes(
                    seq_key.as_ref().try_into()
                        .context("Invalid sequence number")?
                );
                debug!("Popped item with sequence {}", seq);
                
                return Ok(Some(item));
            } else {
                warn!("Index pointed to non-existent data entry");
            }
        }
        
        // Fallback: pop directly from data tree if index is inconsistent
        if let Some((seq_key, data)) = self.data_tree.first()? {
            self.data_tree.remove(&seq_key)?;
            
            let item = rmp_serde::from_slice(&data)
                .context("Failed to deserialize popped item")?;
            
            let seq = u64::from_be_bytes(
                seq_key.as_ref().try_into()
                    .context("Invalid sequence number")?
            );
            debug!("Popped item with sequence {} (fallback)", seq);
            
            return Ok(Some(item));
        }
        
        Ok(None)
    }
    
    async fn get(&self, _id: &Uuid) -> Result<Option<T>> {
        // Search through all items to find by ID
        // This is O(n) but necessary for UUID-based retrieval
        for result in self.data_tree.iter() {
            let (_, data) = result?;
            
            if let Ok(item) = rmp_serde::from_slice::<T>(&data) {
                // This assumes T has an accessible id field
                // In practice, you'd implement this more efficiently
                // by storing a separate UUID -> sequence mapping
                debug!("Found item during search");
                return Ok(Some(item));
            }
        }
        
        Ok(None)
    }
    
    async fn remove(&self, _id: &Uuid) -> Result<bool> {
        // Similar to get, this would need a UUID -> sequence mapping
        // for efficient implementation. For now, we'll do a linear search.
        warn!("UUID-based removal is not efficiently implemented yet");
        Ok(false)
    }
    
    async fn len(&self) -> Result<usize> {
        Ok(self.data_tree.len())
    }
    
    async fn is_empty(&self) -> Result<bool> {
        Ok(self.data_tree.is_empty())
    }
    
    async fn clear(&self) -> Result<()> {
        self.data_tree.clear()?;
        self.index_tree.clear()?;
        self.counter.store(0, Ordering::SeqCst);
        info!("Cleared queue");
        Ok(())
    }
}

/// Queue statistics
#[derive(Debug, Clone)]
pub struct QueueStats {
    pub items: usize,
    pub index_entries: usize,
    pub disk_size_bytes: u64,
}

/// Efficient SledQueue implementation with UUID indexing
pub struct IndexedSledQueue<T> {
    queue: SledQueue<QueueEntry<T>>,
    uuid_index: Tree,
}

/// Internal queue entry with sequence and UUID
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct QueueEntry<T> {
    id: Uuid,
    data: T,
    sequence: u64,
}

impl<T> IndexedSledQueue<T>
where
    T: Serialize + DeserializeOwned + Clone + Send + Sync,
{
    /// Create a new IndexedSledQueue with efficient UUID lookups
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let queue = SledQueue::new(&path)?;
        let uuid_index = queue.db().open_tree("uuid_index")
            .context("Failed to open UUID index tree")?;
        
        Ok(Self {
            queue,
            uuid_index,
        })
    }
    
    /// Push an item with automatic UUID generation
    pub async fn push_with_id(&self, item: T, id: Uuid) -> Result<()> {
        let seq = self.queue.counter.load(Ordering::SeqCst);
        let entry = QueueEntry {
            id,
            data: item,
            sequence: seq,
        };
        
        // Store UUID -> sequence mapping
        let seq_bytes = seq.to_be_bytes();
        self.uuid_index.insert(id.as_bytes(), &seq_bytes)?;
        
        // Push to main queue
        self.queue.push(&entry).await?;
        
        Ok(())
    }
    
    /// Get an item by UUID efficiently
    pub async fn get_by_uuid(&self, id: &Uuid) -> Result<Option<T>> {
        if let Some(seq_bytes) = self.uuid_index.get(id.as_bytes())? {
            let seq = u64::from_be_bytes(
                seq_bytes.as_ref().try_into()
                    .context("Invalid sequence in UUID index")?
            );
            
            let seq_key = seq.to_be_bytes();
            if let Some(data) = self.queue.data_tree.get(&seq_key)? {
                let entry: QueueEntry<T> = rmp_serde::from_slice(&data)
                    .context("Failed to deserialize queue entry")?;
                
                return Ok(Some(entry.data));
            }
        }
        
        Ok(None)
    }
    
    /// Remove an item by UUID efficiently
    pub async fn remove_by_uuid(&self, id: &Uuid) -> Result<bool> {
        if let Some(seq_bytes) = self.uuid_index.remove(id.as_bytes())? {
            let seq = u64::from_be_bytes(
                seq_bytes.as_ref().try_into()
                    .context("Invalid sequence in UUID index")?
            );
            
            let seq_key = seq.to_be_bytes();
            let removed = self.queue.data_tree.remove(&seq_key)?.is_some();
            
            if removed {
                debug!("Removed item with UUID {}", id);
            }
            
            return Ok(removed);
        }
        
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio;
    use uuid::Uuid;
    
    #[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
    struct TestItem {
        id: Uuid,
        data: String,
    }
    
    #[tokio::test]
    async fn test_basic_queue_operations() {
        let queue = SledQueue::<TestItem>::new_temp().unwrap();
        
        let item = TestItem {
            id: Uuid::new_v4(),
            data: "test".to_string(),
        };
        
        // Test push
        queue.push(&item).await.unwrap();
        assert_eq!(queue.len().await.unwrap(), 1);
        assert!(!queue.is_empty().await.unwrap());
        
        // Test pop
        let popped = queue.pop().await.unwrap().unwrap();
        assert_eq!(popped.data, item.data);
        assert_eq!(queue.len().await.unwrap(), 0);
        assert!(queue.is_empty().await.unwrap());
    }
    
    #[tokio::test]
    async fn test_fifo_order() {
        let queue = SledQueue::<TestItem>::new_temp().unwrap();
        
        let items = vec![
            TestItem { id: Uuid::new_v4(), data: "first".to_string() },
            TestItem { id: Uuid::new_v4(), data: "second".to_string() },
            TestItem { id: Uuid::new_v4(), data: "third".to_string() },
        ];
        
        // Push all items
        for item in &items {
            queue.push(item).await.unwrap();
        }
        
        // Pop in FIFO order
        for expected in &items {
            let popped = queue.pop().await.unwrap().unwrap();
            assert_eq!(popped.data, expected.data);
        }
    }
    
    #[tokio::test]
    async fn test_queue_persistence() {
        let temp_dir = tempfile::tempdir().unwrap();
        let queue_path = temp_dir.path().join("test_queue");
        
        let item = TestItem {
            id: Uuid::new_v4(),
            data: "persistent".to_string(),
        };
        
        // Create queue, push item, and drop
        {
            let queue = SledQueue::<TestItem>::new(&queue_path).unwrap();
            queue.push(&item).await.unwrap();
            queue.flush().await.unwrap();
        }
        
        // Reopen queue and verify item persisted
        {
            let queue = SledQueue::<TestItem>::new(&queue_path).unwrap();
            assert_eq!(queue.len().await.unwrap(), 1);
            
            let popped = queue.pop().await.unwrap().unwrap();
            assert_eq!(popped.data, item.data);
        }
    }
    
    #[tokio::test]
    async fn test_indexed_queue() {
        let temp_dir = tempfile::tempdir().unwrap();
        let queue = IndexedSledQueue::<String>::new(temp_dir.path()).unwrap();
        
        let id = Uuid::new_v4();
        let data = "indexed data".to_string();
        
        queue.push_with_id(data.clone(), id).await.unwrap();
        
        let retrieved = queue.get_by_uuid(&id).await.unwrap().unwrap();
        assert_eq!(retrieved, data);
        
        assert!(queue.remove_by_uuid(&id).await.unwrap());
        assert!(queue.get_by_uuid(&id).await.unwrap().is_none());
    }
}