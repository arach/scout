import { useState, useEffect, useCallback, useMemo } from 'react';
import { invokeTyped } from '../types/tauri';
import './StatsView.css';
import '../styles/grid-system.css';

interface DayActivity {
  date: string;
  count: number;
  duration_ms: number;
  words: number;
}

interface Stats {
  total_recordings: number;
  total_duration: number;
  total_words: number;
  current_streak: number;
  longest_streak: number;
  average_daily: number;
  most_active_day: string;
  most_active_hour: number;
  daily_activity: DayActivity[];
  weekly_distribution: [string, number][];
  hourly_distribution: [number, number][];
}

export function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<DayActivity | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [generating, setGenerating] = useState(false);

  // Load stats data
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await invokeTyped<Stats>('get_recording_stats');
      console.log('Stats data received:', data);
      
      // Detailed weekly distribution debugging
      console.log('Weekly distribution type:', typeof data.weekly_distribution);
      console.log('Weekly distribution is array:', Array.isArray(data.weekly_distribution));
      console.log('Weekly distribution length:', data.weekly_distribution.length);
      console.log('Weekly distribution raw:', data.weekly_distribution);
      
      if (data.weekly_distribution.length > 0) {
        const firstItem = data.weekly_distribution[0];
        console.log('First item:', firstItem);
        console.log('First item type:', typeof firstItem);
        console.log('First item is array:', Array.isArray(firstItem));
        console.log('First item structure:', {
          '0': firstItem[0],
          '1': firstItem[1],
          'keys': Object.keys(firstItem),
          'stringified': JSON.stringify(firstItem)
        });
      }
      
      // Check if data might be objects instead of arrays
      const testEmpty = data.weekly_distribution.every((item: any) => {
        console.log('Testing item for empty:', item);
        if (Array.isArray(item)) {
          console.log('Item is array, value at [1]:', item[1]);
          return item[1] === 0;
        } else if (typeof item === 'object') {
          console.log('Item is object, keys:', Object.keys(item));
          // Try common property names
          return item.count === 0 || item.value === 0 || item[1] === 0;
        }
        return true;
      });
      console.log('Empty check result:', testEmpty);
      
      // Debug Saturday data
      const saturdayActivities = data.daily_activity.filter(day => {
        const date = new Date(day.date);
        return date.getDay() === 6; // Saturday
      });
      console.log('Saturday activities:', saturdayActivities);
      
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSampleData = async () => {
    setGenerating(true);
    try {
      const result = await invokeTyped<string>('generate_sample_data');
      console.log(result);
      await loadStats(); // Reload stats after generation
    } catch (error) {
      console.error('Failed to generate sample data:', error);
    } finally {
      setGenerating(false);
    }
  };

  // Format duration for display
  const formatDuration = useCallback((ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }, []);

  // Format large numbers
  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }, []);

  // Calculate color intensity for heatmap - memoized for performance
  const getColorIntensity = useMemo(() => {
    // Pre-calculate thresholds
    const thresholds = [
      { max: 0, color: 'var(--stats-heatmap-level-0)' },
      { max: 2, color: 'var(--stats-heatmap-level-1)' },
      { max: 5, color: 'var(--stats-heatmap-level-2)' },
      { max: 10, color: 'var(--stats-heatmap-level-3)' },
      { max: Infinity, color: 'var(--stats-heatmap-level-4)' }
    ];
    
    return (count: number): string => {
      return thresholds.find(t => count <= t.max)?.color || 'var(--stats-heatmap-level-0)';
    };
  }, []);

  // Generate calendar grid with optimized computation
  const { calendarGrid } = useMemo(() => {
    if (!stats) return { calendarGrid: [], startDate: new Date() };

    const grid = [];
    const today = new Date();
    const daysToShow = 365;
    
    // Start from 365 days ago
    const calculatedStartDate = new Date(today);
    calculatedStartDate.setDate(calculatedStartDate.getDate() - daysToShow + 1);
    
    // Adjust to start on Sunday
    const startDay = calculatedStartDate.getDay();
    calculatedStartDate.setDate(calculatedStartDate.getDate() - startDay);

    // Create a map for quick lookup
    const activityMap = new Map(
      stats.daily_activity.map(day => [day.date, day])
    );

    // Generate all days
    const currentDate = new Date(calculatedStartDate);
    let saturdayCount = 0;
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const activity = activityMap.get(dateStr) || {
        date: dateStr,
        count: 0,
        duration_ms: 0,
        words: 0
      };
      
      const weekday = currentDate.getDay();
      if (weekday === 6) saturdayCount++;
      
      grid.push({
        ...activity,
        weekday: weekday,
        week: Math.floor((currentDate.getTime() - calculatedStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`Generated ${grid.length} days in heatmap, ${saturdayCount} Saturdays`);
    
    // Log Saturday activities
    const saturdayActivities = grid.filter(d => d.weekday === 6 && d.count > 0);
    console.log(`Saturday activities with data: ${saturdayActivities.length}`, saturdayActivities);

    return { calendarGrid: grid, startDate: calculatedStartDate };
  }, [stats]);

  const weeks = useMemo(() => {
    const weekCount = Math.max(...calendarGrid.map(d => d.week || 0)) + 1;
    return Array.from({ length: weekCount }, (_, i) => i);
  }, [calendarGrid]);

  // Debounced mouse move handler to reduce re-renders
  const handleMouseMove = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return (e: React.MouseEvent) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setMousePosition({ x: e.clientX, y: e.clientY });
      }, 16); // ~60fps
    };
  }, []);

  if (loading) {
    return (
      <div className="grid-container">
        <div className="grid-content">
          <div className="stats-loading">
          <div className="loading-spinner"></div>
          <p>Loading stats...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="grid-container">
        <div className="grid-content">
          <div className="stats-empty">
          <p>No stats data loaded. Check console for errors.</p>
          </div>
        </div>
      </div>
    );
  }
  
  // Show empty state if no recordings
  if (stats.total_recordings === 0) {
    return (
      <div className="grid-container">
        <div className="grid-content">
          <div className="stats-empty">
            <div className="empty-state-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
                <path d="M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
                <path d="M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h3>No stats available yet</h3>
            <p>Start recording to see your usage statistics and trends.</p>
            <button 
              className="generate-sample-button"
              onClick={handleGenerateSampleData}
              disabled={generating}
            >
              {generating ? 'Generating...' : 'Generate Sample Data'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-container" onMouseMove={handleMouseMove}>
      <div className="grid-content">
        {/* Primary Stats - Only the main 3 */}
        <div className="stats-metrics-container">
          <div className="stats-metrics-primary">
          <div className="metric-card primary">
            <div className="metric-value primary">{stats.current_streak}</div>
            <div className="metric-label">Day Streak 🔥</div>
          </div>
          <div className="metric-card primary">
            <div className="metric-value primary">{formatNumber(stats.total_recordings)}</div>
            <div className="metric-label">Total Recordings</div>
          </div>
          <div className="metric-card primary">
            <div className="metric-value primary">{formatDuration(stats.total_duration)}</div>
            <div className="metric-label">Time Recorded</div>
            </div>
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="stats-heatmap-container">
        <h2 className="stats-section-title">Activity Overview</h2>
        <div className="stats-heatmap">
          <div className="heatmap-months">
            {/* Month labels will go here */}
          </div>
          <div className="heatmap-content">
            <div className="heatmap-grid">
              {weeks.map(week => (
                <div key={week} className="heatmap-week">
                  {[0, 1, 2, 3, 4, 5, 6].map(day => {
                    const dayData = calendarGrid.find(d => d.week === week && d.weekday === day);
                    if (!dayData) {
                      return <div key={`${week}-${day}`} className="heatmap-day empty"></div>;
                    }
                    
                    // Check if this is a future date
                    const dayDate = new Date(dayData.date);
                    const today = new Date();
                    today.setHours(23, 59, 59, 999); // End of today
                    const isFuture = dayDate > today;
                    
                    if (isFuture) {
                      return <div key={`${week}-${day}`} className="heatmap-day empty"></div>;
                    }
                    
                    return (
                      <div
                        key={`${week}-${day}`}
                        className="heatmap-day"
                        style={{ backgroundColor: getColorIntensity(dayData.count) }}
                        onMouseEnter={() => setHoveredDay(dayData)}
                        onMouseLeave={() => setHoveredDay(null)}
                        data-date={dayData.date}
                        data-count={dayData.count}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="heatmap-legend">
            <span className="legend-label">No activity</span>
            <div className="legend-scale">
              <div className="legend-box" style={{ backgroundColor: 'var(--stats-heatmap-level-0)' }}></div>
              <div className="legend-box" style={{ backgroundColor: 'var(--stats-heatmap-level-1)' }}></div>
              <div className="legend-box" style={{ backgroundColor: 'var(--stats-heatmap-level-2)' }}></div>
              <div className="legend-box" style={{ backgroundColor: 'var(--stats-heatmap-level-3)' }}></div>
              <div className="legend-box" style={{ backgroundColor: 'var(--stats-heatmap-level-4)' }}></div>
            </div>
            <span className="legend-label">High activity</span>
          </div>
          </div>
        </div>

        {/* Secondary Stats - After heatmap */}
        <div className="stats-metrics-container">
        <div className="stats-metrics-secondary">
          <div className="metric-card">
            <div className="metric-value">{stats.longest_streak}</div>
            <div className="metric-label">Best Streak</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{formatNumber(stats.total_words)}</div>
            <div className="metric-label">Words</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{stats.average_daily.toFixed(1)}</div>
            <div className="metric-label">Daily Avg</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{stats.most_active_hour}:00</div>
            <div className="metric-label">Peak Hour</div>
          </div>
          </div>
        </div>

        {/* Time-based insights */}
        <div className="stats-insights">
        <div className="insight-card">
          <h3>Weekly Pattern</h3>
          {(() => {
            // More robust empty check that handles different data structures
            const isEmpty = !stats.weekly_distribution || 
              stats.weekly_distribution.length === 0 ||
              stats.weekly_distribution.every((item: any) => {
                if (Array.isArray(item)) {
                  return item[1] === 0;
                } else if (typeof item === 'object' && item !== null) {
                  // Handle object format
                  return (item.count === 0 || item.value === 0 || item[1] === 0);
                }
                return true;
              });
            
            console.log('Weekly chart empty check:', { isEmpty, data: stats.weekly_distribution });
            return isEmpty;
          })() ? (
            <div className="chart-empty-state">
              <p>No activity data yet</p>
              <p className="empty-state-hint">Start recording to see your weekly patterns</p>
            </div>
          ) : (
            <div className="weekly-chart">
              {stats.weekly_distribution.map((item: any, index: number) => {
                // Debug each item
                console.log(`Processing weekly item ${index}:`, {
                  item,
                  type: typeof item,
                  isArray: Array.isArray(item),
                  keys: typeof item === 'object' ? Object.keys(item) : null,
                  values: typeof item === 'object' ? Object.values(item) : null
                });
                
                // Handle both array and object formats
                let day: string;
                let count: number;
                
                if (Array.isArray(item)) {
                  [day, count] = item;
                } else if (typeof item === 'object' && item !== null) {
                  // Try different possible object structures
                  // Check if it's an object with numeric keys (like {0: "Monday", 1: 107})
                  if ('0' in item && '1' in item) {
                    day = String(item[0]);
                    count = Number(item[1]) || 0;
                  } else {
                    day = item.day || item.name || item.weekday || `Day ${index}`;
                    count = item.count || item.value || item.total || 0;
                  }
                } else {
                  console.error('Unexpected item format:', item);
                  return null;
                }
                
                // Ensure count is a number
                count = Number(count) || 0;
                
                const maxValue = Math.max(...stats.weekly_distribution.map((d: any) => {
                  if (Array.isArray(d)) return Number(d[1]) || 0;
                  if (typeof d === 'object' && d !== null) {
                    if ('0' in d && '1' in d) {
                      return Number(d[1]) || 0;
                    }
                    return Number(d.count || d.value || d.total || d[1]) || 0;
                  }
                  return 0;
                }));
                
                const height = maxValue > 0 ? (count / maxValue) * 100 : 0;
                console.log(`Bar for ${day}: count=${count}, maxValue=${maxValue}, height=${height}%`);
                
                return (
                  <div key={day} className="weekly-bar" title={`${day}: ${count} recordings`}>
                    <div 
                      className="bar" 
                      style={{ 
                        height: height > 0 ? `${height}%` : '2px',
                        opacity: height > 0 ? 1 : 0.3,
                        minHeight: '2px'
                      }}
                      data-count={count}
                      data-height={`${height}%`}
                    />
                    <div className="bar-value">{count > 0 ? count : ''}</div>
                    <div className="bar-label">{String(day).slice(0, 3)}</div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          )}
        </div>

        <div className="insight-card">
          <h3>Daily Activity</h3>
          {(() => {
            // More robust empty check for hourly distribution
            const isEmpty = !stats.hourly_distribution || 
              stats.hourly_distribution.length === 0 ||
              stats.hourly_distribution.every((item: any) => {
                if (Array.isArray(item)) {
                  return item[1] === 0;
                } else if (typeof item === 'object' && item !== null) {
                  return (item.count === 0 || item.value === 0 || item[1] === 0);
                }
                return true;
              });
            
            console.log('Hourly chart empty check:', { isEmpty, data: stats.hourly_distribution });
            return isEmpty;
          })() ? (
            <div className="chart-empty-state">
              <p>No hourly data yet</p>
              <p className="empty-state-hint">Record throughout the day to see your activity patterns</p>
            </div>
          ) : (
            <>
              <div className="hourly-chart">
                <div className="hourly-grid">
                  {Array.from({ length: 24 }, (_, hour) => {
                    // Find activity for this hour with flexible data structure
                    const activity = stats.hourly_distribution.find((item: any) => {
                      if (Array.isArray(item)) {
                        return item[0] === hour;
                      } else if (typeof item === 'object' && item !== null) {
                        return item.hour === hour || item[0] === hour;
                      }
                      return false;
                    });
                    
                    // Extract count with flexible structure
                    let count = 0;
                    if (activity) {
                      if (Array.isArray(activity)) {
                        count = Number(activity[1]) || 0;
                      } else if (typeof activity === 'object' && activity !== null) {
                        count = Number((activity as any).count || (activity as any).value || (activity as any)[1]) || 0;
                      }
                    }
                    
                    // Calculate max count with flexible structure
                    const maxCount = Math.max(...stats.hourly_distribution.map((item: any) => {
                      if (Array.isArray(item)) return Number(item[1]) || 0;
                      if (typeof item === 'object' && item !== null) {
                        return Number(item.count || item.value || item[1]) || 0;
                      }
                      return 0;
                    }));
                    
                    const intensity = maxCount > 0 ? count / maxCount : 0;
                    
                    return (
                      <div 
                        key={hour} 
                        className="hour-cell"
                        style={{ 
                          backgroundColor: intensity > 0 ? `rgba(var(--accent-rgb), ${intensity * 0.8})` : 'var(--background-tertiary)',
                          opacity: intensity > 0 ? 1 : 0.5
                        }}
                        title={`${hour}:00 - ${count} recordings`}
                      >
                        {hour === 0 && '12a'}
                        {hour === 6 && '6a'}
                        {hour === 12 && '12p'}
                        {hour === 18 && '6p'}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="chart-info">
                Most active: {stats.most_active_hour}:00 - {(stats.most_active_hour + 1) % 24}:00
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div 
          className="stats-tooltip"
          style={{
            left: `${mousePosition.x + 10}px`,
            top: `${mousePosition.y - 60}px`
          }}
        >
          <div className="tooltip-date">
            {new Date(hoveredDay.date).toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
          <div className="tooltip-stats">
            <div>{hoveredDay.count} recording{hoveredDay.count !== 1 ? 's' : ''}</div>
            {hoveredDay.count > 0 && (
              <>
                <div>{formatDuration(hoveredDay.duration_ms)}</div>
                <div>~{formatNumber(hoveredDay.words)} words</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}