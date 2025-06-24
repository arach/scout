// Smooth scrolling for anchor links
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for navigation links
    const navLinks = document.querySelectorAll('a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Add scroll effect to header
    let lastScrollY = window.scrollY;
    const header = document.querySelector('.header');
    
    window.addEventListener('scroll', function() {
        const currentScrollY = window.scrollY;
        
        if (currentScrollY > 100) {
            header.style.background = 'rgba(15, 23, 42, 0.95)';
        } else {
            header.style.background = 'rgba(15, 23, 42, 0.8)';
        }
        
        lastScrollY = currentScrollY;
    });
    
    // Add intersection observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe feature cards and use cases
    const animatedElements = document.querySelectorAll('.feature-card, .use-case');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
    
    // Add download link functionality
    const downloadButtons = document.querySelectorAll('a[href="#"]');
    downloadButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            // For now, show a coming soon message
            // In the future, this would link to the actual download
            alert('Download coming soon! Star the GitHub repo to be notified when it\'s available.');
            
            // Redirect to GitHub for now
            window.open('https://github.com/arach/scout', '_blank');
        });
    });
    
    // Add some interactive hover effects
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
    
    // Add gradient animation to hero text
    const gradientText = document.querySelector('.gradient-text');
    if (gradientText) {
        let gradientPosition = 0;
        
        setInterval(() => {
            gradientPosition += 1;
            if (gradientPosition > 100) gradientPosition = 0;
            
            gradientText.style.backgroundImage = `linear-gradient(${135 + gradientPosition}deg, #4F46E5 0%, #7C3AED 100%)`;
        }, 100);
    }
    
    // Simple analytics event tracking (placeholder)
    function trackEvent(eventName, properties = {}) {
        // This would integrate with your analytics service
        console.log('Event:', eventName, properties);
    }
    
    // Track button clicks
    document.addEventListener('click', function(e) {
        if (e.target.matches('.btn-primary')) {
            trackEvent('download_clicked', {
                location: e.target.closest('section')?.id || 'unknown'
            });
        }
        
        if (e.target.matches('.btn-secondary')) {
            trackEvent('github_clicked', {
                location: e.target.closest('section')?.id || 'unknown'
            });
        }
    });
    
    // Track scroll depth
    let maxScrollDepth = 0;
    window.addEventListener('scroll', function() {
        const scrollDepth = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
        
        if (scrollDepth > maxScrollDepth && scrollDepth % 25 === 0) {
            maxScrollDepth = scrollDepth;
            trackEvent('scroll_depth', { depth: scrollDepth });
        }
    });
});