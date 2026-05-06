const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/friends-DZXfDII8.js","assets/firebase-BGgYK--4.js"])))=>i.map(i=>d[i]);
import{s as e}from"./friends-DZXfDII8.js";import"./modulepreload-polyfill-CXK8biUa.js";/* empty css             */import{t,y as n}from"./firebase-BGgYK--4.js";var r=`modulepreload`,i=function(e){return`/bloxverse/`+e},a={},o=function(e,t,n){let o=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),s=document.querySelector(`meta[property=csp-nonce]`),c=s?.nonce||s?.getAttribute(`nonce`);function l(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}o=l(t.map(t=>{if(t=i(t,n),t in a)return;a[t]=!0;let o=t.endsWith(`.css`),s=o?`[rel="stylesheet"]`:``;if(n)for(let n=e.length-1;n>=0;n--){let r=e[n];if(r.href===t&&(!o||r.rel===`stylesheet`))return}else if(document.querySelector(`link[href="${t}"]${s}`))return;let l=document.createElement(`link`);if(l.rel=o?`stylesheet`:r,o||(l.as=`script`),l.crossOrigin=``,l.href=t,c&&l.setAttribute(`nonce`,c),document.head.appendChild(l),o)return new Promise((e,n)=>{l.addEventListener(`load`,e),l.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function s(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return o.then(t=>{for(let e of t||[])e.status===`rejected`&&s(e.reason);return e().catch(s)})},s=document.getElementById(`searchInput`),c=document.getElementById(`searchResults`),l=document.getElementById(`navRight`);n(t,e=>{e&&(l.innerHTML=`
          <div class="user-info">
            <div class="avatar-circle">${(e.displayName||`P`).charAt(0).toUpperCase()}</div>
          </div>
        `)});var u;s.addEventListener(`input`,()=>{clearTimeout(u);let t=s.value.trim();if(t.length<3){c.innerHTML=`
          <div class="search-empty">
            <h2>Search for players</h2>
            <p>Type at least 3 characters to search</p>
          </div>
        `;return}u=setTimeout(async()=>{c.innerHTML=`
          <div class="search-loading">
            <div class="loading-spinner"></div>
            <p>Searching...</p>
          </div>
        `,f(await e(t),t)},300)}),s.addEventListener(`keydown`,e=>{e.key===`Enter`&&s.blur()});var d=new URLSearchParams(window.location.search).get(`q`);d&&(s.value=d,s.dispatchEvent(new Event(`input`)));function f(e,n){if(e.length===0){c.innerHTML=`
          <div class="search-empty">
            <h2>No players found</h2>
            <p>No players match "${n}"</p>
          </div>
        `;return}c.innerHTML=`
        <div class="results-header">
          <h2>Found ${e.length} player${e.length===1?``:`s`}</h2>
        </div>
        <div class="player-grid">
          ${e.map(e=>`
            <div class="player-card" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
              <div class="player-avatar">${(e.username||`?`).charAt(0).toUpperCase()}</div>
              <div class="player-info">
                <div class="player-name">${e.username}</div>
                <div class="player-join-date">Joined ${new Date(e.createdAt||Date.now()).toLocaleDateString()}</div>
              </div>
              <div class="player-action">
                ${e.id===t.currentUser?.uid?``:`<button class="add-friend-btn" onclick="event.stopPropagation(); window._addFriend('${e.id}','${e.username}',this)">+ Add Friend</button>`}
              </div>
            </div>
          `).join(``)}
        </div>
      `}window._addFriend=async(e,n,r)=>{if(!t.currentUser){window.location.href=`/bloxverse/auth.html`;return}r.textContent=`Sending...`,r.disabled=!0;try{let{sendFriendRequest:i}=await o(async()=>{let{sendFriendRequest:e}=await import(`./friends-DZXfDII8.js`).then(e=>e.r);return{sendFriendRequest:e}},__vite__mapDeps([0,1]));await i(t.currentUser.uid,e,n),r.textContent=`Sent`,r.classList.add(`sent`)}catch(e){console.error(e),r.textContent=`Error`,r.disabled=!1}};