const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/friends-UmvAgaV-.js","assets/friends-DJGT6qIQ.js","assets/firebase-FzcSUUQW.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-EeOZK34R.js";/* empty css             */import{g as e,t}from"./firebase-FzcSUUQW.js";import{s as n}from"./friends-DJGT6qIQ.js";import{t as r}from"./preload-helper-CYJHeU-z.js";var i=document.getElementById(`searchInput`),a=document.getElementById(`searchResults`),o=document.getElementById(`navRight`);e(t,e=>{e&&(o.innerHTML=`
          <div class="user-info">
            <div class="avatar-circle">${(e.displayName||`P`).charAt(0).toUpperCase()}</div>
          </div>
        `)});var s;i.addEventListener(`input`,()=>{clearTimeout(s);let e=i.value.trim();if(e.length<3){a.innerHTML=`
          <div class="search-empty">
            <h2>Search for players</h2>
            <p>Type at least 3 characters to search</p>
          </div>
        `;return}s=setTimeout(async()=>{a.innerHTML=`
          <div class="search-loading">
            <div class="loading-spinner"></div>
            <p>Searching...</p>
          </div>
        `,l(await n(e),e)},300)}),i.addEventListener(`keydown`,e=>{e.key===`Enter`&&i.blur()});var c=new URLSearchParams(window.location.search).get(`q`);c&&(i.value=c,i.dispatchEvent(new Event(`input`)));function l(e,n){if(e.length===0){a.innerHTML=`
          <div class="search-empty">
            <h2>No players found</h2>
            <p>No players match "${n}"</p>
          </div>
        `;return}a.innerHTML=`
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
      `}window._addFriend=async(e,n,i)=>{if(!t.currentUser){window.location.href=`/bloxverse/auth.html`;return}i.textContent=`Sending...`,i.disabled=!0;try{let{sendFriendRequest:a}=await r(async()=>{let{sendFriendRequest:e}=await import(`./friends-UmvAgaV-.js`);return{sendFriendRequest:e}},__vite__mapDeps([0,1,2]));await a(t.currentUser.uid,e,n),i.textContent=`Sent`,i.classList.add(`sent`)}catch(e){console.error(e),i.textContent=`Error`,i.disabled=!1}};