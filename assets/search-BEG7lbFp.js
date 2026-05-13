const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/friends-DU0j2RhQ.js","assets/friends-DstcNzDe.js","assets/firebase-HvCPFqZQ.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css             */import{T as e,n as t,r as n}from"./firebase-HvCPFqZQ.js";import{s as r}from"./friends-DstcNzDe.js";import{t as i}from"./preload-helper-B5DiT7NQ.js";var a=document.getElementById(`searchInput`),o=document.getElementById(`searchResults`),s=document.getElementById(`navRight`);e(t,async e=>{if(e){if(await n(e.uid))return;s.innerHTML=`
          <div class="user-info">
            <div class="avatar-circle">${(e.displayName||`P`).charAt(0).toUpperCase()}</div>
          </div>
        `}});var c;a.addEventListener(`input`,()=>{clearTimeout(c);let e=a.value.trim();if(e.length<3){o.innerHTML=`
          <div class="search-empty">
            <h2>Search for players</h2>
            <p>Type at least 3 characters to search</p>
          </div>
        `;return}c=setTimeout(async()=>{o.innerHTML=`
          <div class="search-loading">
            <div class="loading-spinner"></div>
            <p>Searching...</p>
          </div>
        `,u(await r(e),e)},300)}),a.addEventListener(`keydown`,e=>{e.key===`Enter`&&a.blur()});var l=new URLSearchParams(window.location.search).get(`q`);l&&(a.value=l,a.dispatchEvent(new Event(`input`)));function u(e,n){if(e.length===0){o.innerHTML=`
          <div class="search-empty">
            <h2>No players found</h2>
            <p>No players match "${n}"</p>
          </div>
        `;return}o.innerHTML=`
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
      `}window._addFriend=async(e,n,r)=>{if(!t.currentUser){window.location.href=`/bloxverse/auth.html`;return}r.textContent=`Sending...`,r.disabled=!0;try{let{sendFriendRequest:a}=await i(async()=>{let{sendFriendRequest:e}=await import(`./friends-DU0j2RhQ.js`);return{sendFriendRequest:e}},__vite__mapDeps([0,1,2]));await a(t.currentUser.uid,e,n),r.textContent=`Sent`,r.classList.add(`sent`)}catch(e){console.error(e),r.textContent=`Error`,r.disabled=!1}};