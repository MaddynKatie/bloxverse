const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/games-DGLbNy5C.js","assets/games-C_DoiMNO.js","assets/firebase-HvCPFqZQ.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css             */import{D as e,T as t,U as n,h as r,j as i,n as a,o,r as s,v as c}from"./firebase-HvCPFqZQ.js";import{r as l}from"./games-C_DoiMNO.js";import{c as u,i as d,n as f,o as p,r as m,s as h,t as g}from"./friends-DstcNzDe.js";import{t as _}from"./preload-helper-B5DiT7NQ.js";var v=document.getElementById(`navCenter`),y=document.getElementById(`navRight`),b=document.getElementById(`gameGrid`),x=document.getElementById(`friendsSection`),S=document.getElementById(`friendsGrid`),C=document.getElementById(`friendRequests`);function w(e){let t=document.createElement(`div`);return t.className=`game-card`,t.onclick=()=>window.location.href=`/bloxverse/game-detail.html?id=`+e.id,t.innerHTML=`
        <div class="game-thumbnail">
          <img src="${e.icon}" alt="${e.name}" />
          <div class="play-overlay">
            <div class="play-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
          <div class="active-players-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            <span>${e.activePlayers||0}</span>
          </div>
        </div>
        <div class="game-info">
          <h3>${e.name}</h3>
          <div style="font-size:11px;color:#6b6c6e;margin-top:2px;">${(e.visits||0).toLocaleString()} visits</div>
        </div>
      `,t}function T(e,t){let n=[...e];for(let e=n.length-1;e>0;e--){let t=Math.floor(Math.random()*(e+1));[n[e],n[t]]=[n[t],n[e]]}return n.slice(0,t)}async function E(){let{loadGameStats:e,getPublishedGames:t}=await _(async()=>{let{loadGameStats:e,getPublishedGames:t}=await import(`./games-DGLbNy5C.js`);return{loadGameStats:e,getPublishedGames:t}},__vite__mapDeps([0,1,2]));await e();let n=await t(),r=[...l,...n],i=l.filter(e=>e.official),a=document.getElementById(`trendingGrid`),o=r.slice().sort((e,t)=>(t.visits||0)-(e.visits||0));for(let e of T(o,Math.min(6,r.length)))a.appendChild(w(e));let s=document.getElementById(`officialGrid`);for(let e of i)s.appendChild(w(e));for(let e of r)b.appendChild(w(e))}E();var D=null,O=new Set,k=null,A=null,j=null;function M(){return`
        <div class="friend-search-wrapper">
          <div class="friend-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" id="friendSearchInput" placeholder="Search players" autocomplete="off" />
          </div>
        </div>
      `}document.addEventListener(`keydown`,e=>{if(e.key===`/`&&document.activeElement?.id!==`friendSearchInput`&&(e.preventDefault(),document.getElementById(`friendSearchInput`)?.focus()),e.key===`Enter`&&document.activeElement?.id===`friendSearchInput`){let e=document.getElementById(`friendSearchInput`).value.trim();e.length>=3&&(window.location.href=`/bloxverse/search.html?q=${encodeURIComponent(e)}`)}});async function N(e){let t=e.target.value.trim(),n=document.getElementById(`friendSearchResults`);if(t.length<3){n.classList.remove(`visible`);return}let r=await h(t);r.length===0?n.innerHTML=`<div style="padding:12px;color:#8a8c8e;font-size:13px;">No players found</div>`:n.innerHTML=r.map(e=>`
          <div class="search-result-item">
            <div class="search-user-info">
              <div class="search-avatar">${e.username.charAt(0).toUpperCase()}</div>
              <span class="search-username">${e.username}</span>
            </div>
            ${e.id===D?``:O.has(e.id)?`<span class="add-friend-btn sent">Sent</span>`:`<button class="add-friend-btn" onclick="window._addFriend('${e.id}','${e.username}',this)">+ Add</button>`}
          </div>
        `).join(``),n.classList.add(`visible`)}async function P(e,t,n){try{await u(D,e,t),O.add(e),n.textContent=`Sent`,n.classList.add(`sent`),n.onclick=null}catch(e){console.error(e)}}window._addFriend=P;async function F(e){try{let t=await i(n(o,`presence`,e));if(t.exists()){let e=t.data(),n=e.lastSeen?.toMillis?.()??e.lastSeen,r=Date.now()-12e4;if(n&&n<r)return`offline`;if(e.inGame)return`in-game`;if(e.online)return`online`}}catch{}return`offline`}async function I(e){let t=await Promise.all(e.map(e=>F(e.id)));return e.map((e,n)=>({...e,status:t[n]}))}function L(e){return e===`in-game`?`In Game`:e===`online`?`Online`:`Offline`}function R(e){if(e.length===0){S.innerHTML=`<p style="color:#8a8c8e;font-size:13px;padding:8px 0;">No friends yet. Search players above to add friends!</p>`;return}S.innerHTML=e.map(e=>`
                <div class="friend-card" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'" 
style="cursor:pointer;">
          <div class="avatar-with-status">
            <div class="friend-avatar">${e.username.charAt(0).toUpperCase()}</div>
            <div class="status-dot ${e.status}"></div>
          </div>
          <div class="friend-info">
            <div class="friend-name">${e.username}</div>
            <div class="friend-status ${e.status}">${L(e.status)}</div>
          </div>
          <div class="friend-actions" onclick="event.stopPropagation()">
            <button class="friend-action-btn" title="Remove Friend" onclick="window._removeFriend('${e.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `).join(``)}async function z(e){if(e.length===0){C.innerHTML=``;return}C.innerHTML=`<div style="font-size:13px;color:#8a8c8e;margin-bottom:8px;">Friend Requests</div><div class="friend-requests">`+e.map(e=>`
          <div class="friend-request-card">
            <div class="search-avatar">${e.fromUsername?.charAt(0).toUpperCase()||`?`}</div>
            <span class="search-username">${e.fromUsername||`Unknown`}</span>
            <div class="request-actions">
              <button class="request-accept-btn" onclick="window._acceptRequest('${e.id}','${e.from}','${e.to}')">Accept</button>
              <button class="request-decline-btn" onclick="window._declineRequest('${e.id}')">Decline</button>
            </div>
          </div>
        `).join(``)+`</div>`}window._acceptRequest=async(e,t,n)=>{await g(e,t,n),B()},window._declineRequest=async e=>{await f(e),B()},window._removeFriend=async e=>{confirm(`Remove this friend?`)&&(await p(D,e),B())};async function B(){if(!D)return;let[e,t]=await Promise.all([d(D),m(D)]),r=await I(e);for(let e of t)try{let t=await i(n(o,`users`,e.from));e.fromUsername=t.exists()?t.data().username:`Unknown`}catch{e.fromUsername=`Unknown`}R(r),z(t)}function V(e){j&&j!==e&&j.classList.remove(`open`),e.classList.toggle(`open`),j=e.classList.contains(`open`)?e:null}t(a,async e=>{if(k&&=(k(),null),A&&=(A.goOffline(),null),e){if(await s(e.uid))return;D=e.uid;let t=e.displayName||`Player`,a=0;try{let r=await i(n(o,`users`,e.uid));if(r.exists()){let e=r.data();t=e.username||t,a=e.bux||0}}catch{}A=c(e.uid);let l=t.charAt(0).toUpperCase();v.innerHTML=M(),document.getElementById(`friendSearchInput`).addEventListener(`input`,N);let u=`buxValue`;y.innerHTML=`
          <button class="create-btn" onclick="window.location.href='/bloxverse/create.html'">✨ Create</button>
          <div class="user-info">
            <button class="bux-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
              </svg>
              <span id="${u}">${a.toLocaleString()}</span>
            </button>
            <div class="avatar-dropdown" id="userDropdown">
              <div class="avatar-circle">${l}</div>
              <div class="dropdown-menu">
                <div class="dropdown-header">
                  <span class="dropdown-name">${t}</span>
                  <span class="dropdown-email">${e.email}</span>
                </div>
                <button class="dropdown-item" onclick="window.location.href='/bloxverse/profile.html'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </button>
                <button class="dropdown-item" onclick="window.location.href='/bloxverse/avatar.html'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Avatar
                </button>
                <button class="dropdown-item" onclick="window._logout()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Log Out
                </button>
              </div>
            </div>
          </div>
        `;let d=document.querySelector(`#userDropdown .avatar-circle`),f=document.getElementById(`userDropdown`);d.addEventListener(`click`,e=>{e.stopPropagation(),V(f)}),k=r(e.uid,e=>{let t=document.getElementById(u);t&&(t.textContent=e.toLocaleString())},t,e.email),x.style.display=`block`,B()}else D=null,v.innerHTML=``,y.innerHTML=`<button class="login-btn" 
onclick="window.location.href='/bloxverse/auth.html'">Login / Sign Up</button>`,x.style.display=`none`,j&&=(j.classList.remove(`open`),null)}),window._logout=async()=>{k&&=(k(),null),A&&=(A.goOffline(),null),await e(a),window.location.href=`/bloxverse/`},document.addEventListener(`click`,e=>{let t=document.getElementById(`friendSearchResults`);t&&!e.target.closest(`.friend-search-wrapper`)&&t.classList.remove(`visible`),j&&!j.contains(e.target)&&(j.classList.remove(`open`),j=null)});