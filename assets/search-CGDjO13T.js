const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/friends-Bpw8jEG5.js","assets/friends-CLdMBLWm.js","assets/firebase-CcrBuBby.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css             */import{K as e,L as t,O as n,i as r,r as i,s as a}from"./firebase-CcrBuBby.js";import{s as o}from"./friends-CLdMBLWm.js";import{t as s}from"./preload-helper-B5DiT7NQ.js";var c=document.getElementById(`searchInput`),l=document.getElementById(`searchResults`),u=document.getElementById(`navRight`);n(i,async n=>{if(n){if(await r(n.uid))return;t(e(a,`bans`,n.uid),e=>{e.exists()&&e.data().banned&&(window.location.href=`/bloxverse/ban`)}),u.innerHTML=`
          <div class="user-info">
            <div class="avatar-circle">${(n.displayName||`P`).charAt(0).toUpperCase()}</div>
          </div>
        `}});var d;c.addEventListener(`input`,()=>{clearTimeout(d);let e=c.value.trim();if(e.length<3){l.innerHTML=`
          <div class="search-empty">
            <h2>Search for players</h2>
            <p>Type at least 3 characters to search</p>
          </div>
        `;return}d=setTimeout(async()=>{l.innerHTML=`
          <div class="search-loading">
            <div class="loading-spinner"></div>
            <p>Searching...</p>
          </div>
        `,p(await o(e),e)},300)}),c.addEventListener(`keydown`,e=>{e.key===`Enter`&&c.blur()});var f=new URLSearchParams(window.location.search).get(`q`);f&&(c.value=f,c.dispatchEvent(new Event(`input`)));function p(e,t){if(e.length===0){l.innerHTML=`
          <div class="search-empty">
            <h2>No players found</h2>
            <p>No players match "${t}"</p>
          </div>
        `;return}l.innerHTML=`
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
                ${e.id===i.currentUser?.uid?``:`<button class="add-friend-btn" onclick="event.stopPropagation(); window._addFriend('${e.id}','${e.username}',this)">+ Add Friend</button>`}
              </div>
            </div>
          `).join(``)}
        </div>
      `}window._addFriend=async(e,t,n)=>{if(!i.currentUser){window.location.href=`/bloxverse/auth.html`;return}n.textContent=`Sending...`,n.disabled=!0;try{let{sendFriendRequest:r}=await s(async()=>{let{sendFriendRequest:e}=await import(`./friends-Bpw8jEG5.js`);return{sendFriendRequest:e}},__vite__mapDeps([0,1,2]));await r(i.currentUser.uid,e,t),n.textContent=`Sent`,n.classList.add(`sent`)}catch(e){console.error(e),n.textContent=`Error`,n.disabled=!1}};