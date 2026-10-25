/* ============================================================
   Clarity Journal — loading overlay (three concentric spinning rings)
   Used by the sign-in and sign-up pages while they work:
     CJLoader.show('Signing in…');   // dims the page and shows the rings
     CJLoader.hide();                // back to the form (e.g. after a wrong password)
   ============================================================ */
(function(){
  const css = `
    .cj-loader{position:fixed; inset:0; z-index:1000; display:none; flex-direction:column; align-items:center; justify-content:center; gap:18px;
      background:rgba(8,19,38,.72); -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);}
    .cj-loader.show{display:flex;}
    .cj-rings{position:relative; width:48px; height:48px; display:flex; align-items:center; justify-content:center;}
    .cj-rings i{position:absolute; border-radius:50%; border:2px solid; animation:cj-spin linear infinite;}
    .cj-rings i:nth-child(1){width:48px; height:48px; border-color:#52525b; border-top-color:transparent; animation-duration:2s;}
    .cj-rings i:nth-child(2){width:32px; height:32px; border-color:#71717a; border-bottom-color:transparent; animation-duration:1.5s; animation-direction:reverse;}
    .cj-rings i:nth-child(3){width:16px; height:16px; border-color:#d4d4d8; border-left-color:transparent; animation-duration:1s;}
    .cj-loader-text{margin:0; font:600 14px 'Inter',sans-serif; color:#D1D5DB;}
    @keyframes cj-spin{to{transform:rotate(360deg);}}
    @media (prefers-reduced-motion: reduce){ .cj-rings i{animation-duration:6s !important;} }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  let el = null, text = null, opener = null;
  function build(){
    el = document.createElement('div');
    el.className = 'cj-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="cj-rings" aria-hidden="true"><i></i><i></i><i></i></div><p class="cj-loader-text"></p>';
    text = el.querySelector('.cj-loader-text');
    document.body.appendChild(el);
  }

  window.CJLoader = {
    show(label){
      if(!el) build();
      text.textContent = label || 'Loading…';
      opener = document.activeElement;
      if(opener && opener.blur) opener.blur();      // the form is behind the overlay, so nothing can be typed into
      el.classList.add('show');
      document.documentElement.setAttribute('aria-busy', 'true');
    },
    hide(){
      if(!el) return;
      el.classList.remove('show');
      document.documentElement.removeAttribute('aria-busy');
      if(opener && opener.isConnected && opener.focus){ try{ opener.focus({ preventScroll:true }); }catch(e){} }
      opener = null;
    },
  };
})();
