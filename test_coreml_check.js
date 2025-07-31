// Test script to verify Core ML checking functionality
// Run this in the browser console when the app is running

async function testCoreMLCheck() {
  try {
    console.log('🔍 Testing Core ML check functionality...');
    
    // First, get available models
    const models = await window.__TAURI__.invoke('get_available_models');
    console.log('📦 Available models:', models);
    
    // Check which models have GGML but not Core ML
    const missingCoreML = models.filter(m => m.downloaded && !m.coreml_downloaded && m.coreml_url);
    console.log('⚠️ Models missing Core ML:', missingCoreML.map(m => m.id));
    
    // Run the check and download command
    console.log('🚀 Running Core ML check and download...');
    const result = await window.__TAURI__.invoke('check_and_download_missing_coreml_models');
    console.log('✅ Downloaded Core ML for:', result);
    
    // Get models again to verify
    const updatedModels = await window.__TAURI__.invoke('get_available_models');
    const stillMissing = updatedModels.filter(m => m.downloaded && !m.coreml_downloaded && m.coreml_url);
    console.log('📊 Final status - models still missing Core ML:', stillMissing.map(m => m.id));
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
testCoreMLCheck();