const TARGET_TREES = 1000000;
        const UPDATE_INTERVAL_MS = 5000;
        const ANIMATION_DURATION_MS = 2000;
        
        const menuToggle = document.getElementById('menuToggle');
        const navLinks = document.getElementById('navLinks');
        const liveTreeCountElement = document.getElementById('tree-count');
        const progressBarFill = document.getElementById('progressBarFill');
        const statsSection = document.getElementById('stats');
        const statItems = document.querySelectorAll('.stats__number');
        const backToTopButton = document.getElementById('back-to-top');
        const faqItems = document.querySelectorAll('.faq__item');
        const darkModeToggle = document.getElementById('darkModeToggle');
        const darkModeIcon = document.getElementById('darkModeIcon');
        
        let currentLiveCount = parseInt(liveTreeCountElement.getAttribute('data-initial'));
        let animationStarted = false;

        // 1. GESTION DU MODE SOMBRE (DARK MODE)
        // Vérifie les préférences utilisateur ou le stockage local
        const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            darkModeIcon.classList.remove('fa-moon');
            darkModeIcon.classList.add('fa-sun');
        }

        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDarkMode = document.body.classList.contains('dark-mode');
            
            // Mise à jour de l'icône et du localStorage
            if (isDarkMode) {
                darkModeIcon.classList.remove('fa-moon');
                darkModeIcon.classList.add('fa-sun');
                localStorage.setItem('theme', 'dark');
            } else {
                darkModeIcon.classList.remove('fa-sun');
                darkModeIcon.classList.add('fa-moon');
                localStorage.setItem('theme', 'light');
            }
        });

        // 2. MISE À JOUR DU COMPTEUR LIVE ET DE LA BARRE DE PROGRESSION
        function updateLiveCountAndProgress() {
            if (!liveTreeCountElement || !progressBarFill) return;

            // Augmentation réaliste du compteur (simulation d'une activité en temps réel)
            currentLiveCount += Math.floor(Math.random() * 5) + 1; 
            liveTreeCountElement.textContent = currentLiveCount.toLocaleString('en-US'); 
            
            const progressPercentage = Math.min((currentLiveCount / TARGET_TREES) * 100, 100);
            progressBarFill.style.width = `${progressPercentage}%`;

            progressBarFill.parentElement.setAttribute('aria-valuenow', progressPercentage.toFixed(2));
        }
        setInterval(updateLiveCountAndProgress, UPDATE_INTERVAL_MS);


        // 3. ANIMATION DES COMPTEURS DE STATISTIQUES
        function animateStats() {
            if (animationStarted) return; 
            animationStarted = true;

            statItems.forEach(item => {
                const target = parseInt(item.getAttribute('data-target'));
                let start = 0;
                const stepTime = 10;
                const increment = target / (ANIMATION_DURATION_MS / stepTime);

                const timer = setInterval(() => {
                    start += increment;
                    
                    if (start >= target) {
                        start = target;
                        clearInterval(timer);
                    }
                    
                    item.textContent = Math.floor(start).toLocaleString('en-US');
                }, stepTime);
            });
        }

        if (statsSection) {
            const statsObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        animateStats();
                        statsObserver.unobserve(entry.target); 
                    }
                });
            }, { threshold: 0.5 }); 

            statsObserver.observe(statsSection);
        }

        // 4. GESTION DU MENU MOBILE (Hamburger Menu)
        if (menuToggle && navLinks) {
            menuToggle.addEventListener('click', () => {
                const isExpanded = navLinks.classList.toggle('active');
                menuToggle.setAttribute('aria-expanded', isExpanded);
                
                // Haptic feedback sur mobile
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
                
                const icon = menuToggle.querySelector('i');
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
                
                // Empêcher le scroll du body quand le menu est ouvert
                if (isExpanded) {
                    document.body.style.overflow = 'hidden';
                } else {
                    document.body.style.overflow = '';
                }
            });

            navLinks.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 992) {
                        navLinks.classList.remove('active');
                        menuToggle.setAttribute('aria-expanded', false);
                        const icon = menuToggle.querySelector('i');
                        icon.classList.add('fa-bars');
                        icon.classList.remove('fa-times');
                    }
                });
            });
        }

        // 5. GESTION DE LA FAQ (Accordéon)
        faqItems.forEach(item => {
            const question = item.querySelector('.faq__question');
            const answer = item.querySelector('.faq__answer');

            question.addEventListener('click', () => {
                const isExpanded = question.getAttribute('aria-expanded') === 'true' || false;
                
                // Haptic feedback
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
                
                // Fermer les autres pour un meilleur confort (UX)
                faqItems.forEach(otherItem => {
                    const otherQuestion = otherItem.querySelector('.faq__question');
                    const otherAnswer = otherItem.querySelector('.faq__answer');
                    if (otherQuestion !== question && otherQuestion.getAttribute('aria-expanded') === 'true') {
                        otherQuestion.setAttribute('aria-expanded', 'false');
                        otherAnswer.style.maxHeight = '0';
                    }
                });
                
                question.setAttribute('aria-expanded', !isExpanded);
                if (!isExpanded) {
                    answer.style.maxHeight = answer.scrollHeight + 'px';
                    // Animation d'ouverture
                    answer.style.opacity = '0';
                    setTimeout(() => {
                        answer.style.transition = 'opacity 0.3s';
                        answer.style.opacity = '1';
                    }, 10);
                } else {
                    answer.style.maxHeight = '0';
                    answer.style.opacity = '0';
                }
            });
            // Initialisation de l'accordéon
            answer.style.maxHeight = '0';
            answer.style.opacity = '0';
        });

        // 6. BOUTON "RETOUR EN HAUT"
        if (backToTopButton) {
            window.addEventListener('scroll', () => {
                backToTopButton.style.display = (window.scrollY > 500) ? 'flex' : 'none';
            });

            backToTopButton.addEventListener('click', () => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            });
        }

        // Initialisation de la Top Bar au chargement
        document.addEventListener('DOMContentLoaded', updateLiveCountAndProgress);
