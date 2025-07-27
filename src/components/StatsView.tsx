import { useState, useEffect, useCallback, useMemo } from 'react';
import { invokeTyped } from '../types/tauri';
import './StatsView.css';

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

  // Load stats data
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await invokeTyped<Stats>('get_recording_stats');
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
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

  // Calculate color intensity for heatmap
  const getColorIntensity = useCallback((count: number): string => {
    if (count === 0) return 'var(--stats-heatmap-level-0)';
    if (count <= 2) return 'var(--stats-heatmap-level-1)';
    if (count <= 5) return 'var(--stats-heatmap-level-2)';
    if (count <= 10) return 'var(--stats-heatmap-level-3)';
    return 'var(--stats-heatmap-level-4)';
  }, []);

  // Generate calendar grid
  const calendarGrid = useMemo(() => {
    if (!stats) return [];

    const grid = [];
    const today = new Date();
    const daysToShow = 365;
    
    // Start from 365 days ago
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysToShow + 1);
    
    // Adjust to start on Sunday
    const startDay = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDay);

    // Create a map for quick lookup
    const activityMap = new Map(
      stats.daily_activity.map(day => [day.date, day])
    );

    // Generate all days
    const currentDate = new Date(startDate);
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const activity = activityMap.get(dateStr) || {
        date: dateStr,
        count: 0,
        duration_ms: 0,
        words: 0
      };
      
      grid.push({
        ...activity,
        weekday: currentDate.getDay(),
        week: Math.floor((currentDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return grid;
  }, [stats]);

  const weeks = useMemo(() => {
    const weekCount = Math.max(...calendarGrid.map(d => d.week || 0)) + 1;
    return Array.from({ length: weekCount }, (_, i) => i);
  }, [calendarGrid]);

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  };

  if (loading) {
    return (
      <div className="stats-view">
        <div className="stats-loading">
          <div className="loading-spinner"></div>
          <p>Loading stats...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="stats-view">
        <div className="stats-empty">
          <p>No stats data loaded. Check console for errors.</p>
        </div>
      </div>
    );
  }
  
  // Show empty state if no recordings
  if (stats.total_recordings === 0) {
    return (
      <div className="stats-view">
        <div className="stats-empty">
          <p>No recordings yet. Start recording to see your stats!</p>
        </div>
      </div>
    );
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="stats-view" onMouseMove={handleMouseMove}>
      {/* Key Metrics */}
      <div className="stats-metrics-container">
        {/* Primary Stats */}
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
        
        {/* Secondary Stats */}
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

      {/* Activity Heatmap */}
      <div className="stats-heatmap-container">
        <h2 className="stats-section-title">Activity Overview</h2>
        <div className="stats-heatmap">
          <div className="heatmap-months">
            {/* Month labels will go here */}
          </div>
          <div className="heatmap-content">
            <div className="heatmap-weekdays">
              {dayNames.map((day, i) => (
                <div key={day} className="weekday-label" style={{ gridRow: i + 1 }}>
                  {i % 2 === 1 ? day : ''}
                </div>
              ))}
            </div>
            <div className="heatmap-grid">
              {weeks.map(week => (
                <div key={week} className="heatmap-week">
                  {[0, 1, 2, 3, 4, 5, 6].map(day => {
                    const dayData = calendarGrid.find(d => d.week === week && d.weekday === day);
                    if (!dayData) return <div key={`${week}-${day}`} className="heatmap-day empty"></div>;
                    
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

      {/* Time-based insights */}
      <div className="stats-insights">
        <div className="insight-card">
          <h3>Weekly Pattern</h3>
          <div className="weekly-chart">
            {stats.weekly_distribution.map(([day, count]) => (
              <div key={day} className="weekly-bar">
                <div 
                  className="bar" 
                  style={{ 
                    height: `${(count / Math.max(...stats.weekly_distribution.map(d => d[1]))) * 100}%` 
                  }}
                />
                <div className="bar-label">{day.slice(0, 3)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card">
          <h3>Daily Activity</h3>
          <div className="hourly-chart">
            <div className="hourly-grid">
              {Array.from({ length: 24 }, (_, hour) => {
                const activity = stats.hourly_distribution.find(h => h[0] === hour);
                const count = activity?.[1] || 0;
                const maxCount = Math.max(...stats.hourly_distribution.map(h => h[1]));
                const intensity = maxCount > 0 ? count / maxCount : 0;
                
                return (
                  <div 
                    key={hour} 
                    className="hour-cell"
                    style={{ 
                      backgroundColor: `rgba(var(--accent-rgb), ${intensity * 0.8})` 
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