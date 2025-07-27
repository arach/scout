import { useEffect, useState, useRef, useCallback, memo } from 'react';

interface RecordingTimerProps {
    startTime: number | null;
    formatTimer: (ms: number) => string;
}

const TIMER_INTERVAL = 10; // Update every 10ms for smooth centisecond display

export const RecordingTimer = memo(function RecordingTimer({ startTime, formatTimer }: RecordingTimerProps) {
    const [elapsed, setElapsed] = useState(0);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number | null>(null);

    // Use callback to avoid creating new function on each render
    const updateTimer = useCallback(() => {
        if (startTimeRef.current) {
            const now = Date.now();
            const duration = now - startTimeRef.current;
            setElapsed(duration);
        }
    }, []);

    useEffect(() => {
        // Update ref to avoid stale closure
        startTimeRef.current = startTime;

        if (!startTime) {
            setElapsed(0);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return;
        }

        // Set initial value immediately
        updateTimer();

        // Start interval for updates
        intervalRef.current = setInterval(updateTimer, TIMER_INTERVAL);

        // Cleanup
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [startTime, updateTimer]);

    return <>{formatTimer(elapsed)}</>;
});