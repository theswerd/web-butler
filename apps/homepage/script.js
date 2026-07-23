// The demo loop: the pill wakes, takes one errand, works, and delivers a
// page extension — then the sponsored posts fold away. States live on the
// window's [data-state]; the CSS does all the drawing.
(() => {
  const demo = document.getElementById('demo');
  const typed = document.getElementById('typed');
  const pill = demo.querySelector('.pill');
  const ERRAND = 'Always hide the sponsored posts here';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) {
    // No theater: rest on the delivered state.
    demo.dataset.state = 'done';
    typed.textContent = '';
    return;
  }

  let timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));

  function run() {
    timers.forEach(clearTimeout);
    timers = [];
    typed.textContent = '';
    demo.dataset.state = 'idle';

    later(900, () => (demo.dataset.state = 'open'));
    later(1700, () => {
      demo.dataset.state = 'typing';
      let i = 0;
      const type = () => {
        typed.textContent = ERRAND.slice(0, ++i);
        if (i < ERRAND.length) timers.push(setTimeout(type, 34 + Math.random() * 40));
        else later(500, work);
      };
      type();
    });

    function work() {
      demo.dataset.state = 'working';
      pill.classList.add('working');
      later(4100, () => {
        pill.classList.remove('working');
        demo.dataset.state = 'done';
        later(5200, run); // hold the delivered state, then take it again
      });
    }
  }

  // Start when the demo scrolls into view; pause the loop off-screen.
  let started = false;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !started) {
          started = true;
          run();
        }
      }
    },
    { threshold: 0.35 },
  );
  io.observe(demo);
})();
