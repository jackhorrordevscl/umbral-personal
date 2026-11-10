// Runs before first paint (loaded synchronously from index.html) to avoid a
// light/dark flash. The app is light by default: dark only when the user chose
// it with the toggle, never from the OS preference (same rule as the landing).
// It is an external file because the CSP uses script-src 'self' (no inline).
(function () {
  try {
    if (localStorage.getItem('umbral-theme') === 'dark') {
      document.documentElement.classList.add('dark');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0b1120');
    }
  } catch (e) {
    // storage can throw (blocked cookies, sandboxed frames): stay on light
  }
})();
