import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export const useAudioBlob = (audioPath: string) => {
    console.log('🔊 useAudioBlob: Hook called with audioPath:', audioPath);
    
    const [blob, setBlob] = useState<Blob | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        console.log('🔊 useAudioBlob: Effect triggered with audioPath:', audioPath);
        let isMounted = true;
        
        const fetchAudio = async () => {
            console.log('🔊 useAudioBlob: fetchAudio called');
            
            if (!audioPath) {
                console.log('🔊 useAudioBlob: No audioPath provided, setting loading to false');
                if (isMounted) setIsLoading(false);
                return;
            }

            if (isMounted) {
                console.log('🔊 useAudioBlob: Starting audio fetch for:', audioPath);
                setIsLoading(true);
                setError(null);
                setBlob(null);
            }

            try {
                console.log('🔊 useAudioBlob: Calling read_audio_file with:', audioPath);
                // Expect number[] (Vec<u8> from rust)
                const audioData: number[] = await invoke('read_audio_file', { audioPath });
                console.log('🔊 useAudioBlob: Got audio data, length:', audioData.length);
                
                if (!isMounted) {
                    console.log('🔊 useAudioBlob: Component unmounted, aborting');
                    return;
                }
                
                const audioBlob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });
                console.log('🔊 useAudioBlob: Created blob with size:', audioBlob.size, 'type:', audioBlob.type);

                if (isMounted) {
                    setBlob(audioBlob);
                    console.log('🔊 useAudioBlob: Blob set successfully');
                }

            } catch (err: any) {
                console.error('🔊 useAudioBlob: Error fetching audio:', err);
                if (isMounted) {
                    setError(err.message || 'An unknown error occurred.');
                }
            } finally {
                if (isMounted) {
                    console.log('🔊 useAudioBlob: Setting loading to false');
                    setIsLoading(false);
                }
            }
        };

        const handler = setTimeout(() => {
            fetchAudio();
        }, 50);

        return () => {
            console.log('🔊 useAudioBlob: Cleanup, unmounting');
            isMounted = false;
            clearTimeout(handler);
        };
    }, [audioPath]);

    console.log('🔊 useAudioBlob: Returning state:', {
        hasBlob: !!blob,
        blobSize: blob?.size,
        isLoading,
        error
    });

    return { blob, isLoading, error };
}; 