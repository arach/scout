import React, { useEffect, useRef } from 'react';
import './ParticleRecordingIndicator.css';

interface ParticleRecordingIndicatorProps {
    isRecording: boolean;
    audioLevel: number;
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    maxLife: number;
    opacity: number;
    color: string;
}

const ParticleRecordingIndicator: React.FC<ParticleRecordingIndicatorProps> = ({ 
    isRecording, 
    audioLevel 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const animationFrameRef = useRef<number>();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        const updateCanvasSize = () => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);

        // Particle system
        const particles = particlesRef.current;
        const maxParticles = isRecording ? 80 : 30;
        
        const createParticle = (): Particle => {
            const width = canvas.width / window.devicePixelRatio;
            const height = canvas.height / window.devicePixelRatio;
            
            // Particles spawn from center area and flow outward horizontally
            const spawnX = width / 2 + (Math.random() - 0.5) * 100;
            const spawnY = height / 2 + (Math.random() - 0.5) * 20;
            
            // Horizontal flow with audio influence
            const baseSpeed = 1 + audioLevel * 2;
            const direction = Math.random() > 0.5 ? 1 : -1; // Left or right
            
            return {
                x: spawnX,
                y: spawnY,
                vx: direction * baseSpeed * (0.5 + Math.random() * 1.5), // Horizontal flow
                vy: (Math.random() - 0.5) * 0.5, // Minimal vertical movement
                size: 1 + Math.random() * 2 + audioLevel * 2,
                life: 0,
                maxLife: 120 + Math.random() * 60,
                opacity: 0,
                color: isRecording ? '#007AFF' : '#666666'
            };
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);

            // Add new particles based on audio level
            if (isRecording && particles.length < maxParticles) {
                const particlesToAdd = Math.floor(1 + audioLevel * 3);
                for (let i = 0; i < particlesToAdd; i++) {
                    particles.push(createParticle());
                }
            } else if (!isRecording && particles.length < 20) {
                // Fewer particles when idle
                if (Math.random() < 0.1 + audioLevel * 0.3) {
                    particles.push(createParticle());
                }
            }

            // Update and draw particles
            for (let i = particles.length - 1; i >= 0; i--) {
                const particle = particles[i];
                
                // Update position
                particle.x += particle.vx;
                particle.y += particle.vy;
                
                // Apply slight gravity
                particle.vy += 0.02;
                
                // Apply horizontal drift
                particle.vx *= 0.99;
                
                // Update life
                particle.life++;
                
                // Calculate opacity based on life
                const lifeRatio = particle.life / particle.maxLife;
                const opacity = 1 - lifeRatio;
                
                // Draw particle
                ctx.globalAlpha = opacity;
                ctx.fillStyle = particle.color;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                ctx.fill();
                
                // Add glow effect
                if (isRecording) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = particle.color;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
                
                // Remove dead particles
                if (particle.life >= particle.maxLife) {
                    particles.splice(i, 1);
                }
            }
            
            ctx.globalAlpha = 1;
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            window.removeEventListener('resize', updateCanvasSize);
        };
    }, [isRecording, audioLevel]);

    return (
        <div className="particle-recording-indicator">
            <div className="particle-backdrop" />
            <canvas 
                ref={canvasRef}
                className="particle-canvas"
            />
        </div>
    );
};

export default ParticleRecordingIndicator;