import { useState, useEffect } from 'react';
import { tauriApi } from '../types/tauri';

export const useAudioBlob = (audioPath: string) => {
    const [blob, setBlob] = useState<Blob | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        
        const fetchAudio = async () => {
            if (!audioPath) {
                if (isMounted) setIsLoading(false);
                return;
            }

            if (isMounted) {
                setIsLoading(true);
                setError(null);
                setBlob(null);
            }

            try {
                const audioData: number[] = await tauriApi.readAudioFile({ audioPath });
                
                if (!isMounted) {
                    return;
                }
                
                const audioBlob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });

                if (isMounted) {
                    setBlob(audioBlob);
                }

            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'An unknown error occurred.');
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        const handler = setTimeout(() => {
            fetchAudio();
        }, 50);

        return () => {
            isMounted = false;
            clearTimeout(handler);
        };
    }, [audioPath]);

    return { blob, isLoading, error };
}; 