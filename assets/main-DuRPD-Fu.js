const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/games-DE24-d1H.js","assets/games-Bc8MJbpQ.js","assets/firebase-FzcSUUQW.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-EeOZK34R.js";/* empty css             */import{N as e,S as t,d as n,g as r,l as i,n as a,t as o,v as s}from"./firebase-FzcSUUQW.js";import{r as c}from"./games-Bc8MJbpQ.js";import{c as l,i as u,n as d,o as f,r as p,s as m,t as h}from"./friends-DJGT6qIQ.js";import{t as g}from"./preload-helper-CYJHeU-z.js";var _=document.getElementById(`navCenter`),v=document.getElementById(`navRight`),y=document.getElementById(`gameGrid`),b=document.getElementById(`friendsSection`),x=document.getElementById(`friendsGrid`),S=document.getElementById(`friendRequests`);function C(e){let t=document.createElement(`div`);return t.className=`game-card`,t.onclick=()=>window.location.href=`/bloxverse/game-detail.html?id=`+e.id,t.innerHTML=`
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
      `,t}async function w(){let{loadGameStats:e,getPublishedGames:t}=await g(async()=>{let{loadGameStats:e,getPublishedGames:t}=await import(`./games-DE24-d1H.js`);return{loadGameStats:e,getPublishedGames:t}},__vite__mapDeps([0,1,2]));await e();for(let e of c)y.appendChild(C(e));let n=await t();if(n.length>0){let e=document.createElement(`section`);e.className=`game-section`,e.innerHTML=`<h2>Community Games</h2><div class="game-grid" id="communityGrid"></div>`,document.querySelector(`.main-content`).appendChild(e);let t=document.getElementById(`communityGrid`);for(let e of n)t.appendChild(C(e))}}w();var T=null,E=new Set,D=null,O=null,k=null;function A(){return`
        <div class="friend-search-wrapper">
          <div class="friend-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" id="friendSearchInput" placeholder="Search players" autocomplete="off" />
          </div>
        </div>
      `}document.addEventListener(`keydown`,e=>{if(e.key===`/`&&document.activeElement?.id!==`friendSearchInput`&&(e.preventDefault(),document.getElementById(`friendSearchInput`)?.focus()),e.key===`Enter`&&document.activeElement?.id===`friendSearchInput`){let e=document.getElementById(`friendSearchInput`).value.trim();e.length>=3&&(window.location.href=`/bloxverse/search.html?q=${encodeURIComponent(e)}`)}});async function j(e){let t=e.target.value.trim(),n=document.getElementById(`friendSearchResults`);if(t.length<3){n.classList.remove(`visible`);return}let r=await m(t);r.length===0?n.innerHTML=`<div style="padding:12px;color:#8a8c8e;font-size:13px;">No players found</div>`:n.innerHTML=r.map(e=>`
          <div class="search-result-item">
            <div class="search-user-info">
              <div class="search-avatar">${e.username.charAt(0).toUpperCase()}</div>
              <span class="search-username">${e.username}</span>
            </div>
            ${e.id===T?``:E.has(e.id)?`<span class="add-friend-btn sent">Sent</span>`:`<button class="add-friend-btn" onclick="window._addFriend('${e.id}','${e.username}',this)">+ Add</button>`}
          </div>
        `).join(``),n.classList.add(`visible`)}async function M(e,t,n){try{await l(T,e,t),E.add(e),n.textContent=`Sent`,n.classList.add(`sent`),n.onclick=null}catch(e){console.error(e)}}window._addFriend=M;async function N(n){try{let r=await t(e(a,`presence`,n));if(r.exists()){let e=r.data();if(e.inGame)return`in-game`;if(e.online)return`online`}}catch{}return`offline`}async function P(e){let t=await Promise.all(e.map(e=>N(e.id)));return e.map((e,n)=>({...e,status:t[n]}))}function F(e){return e===`in-game`?`In Game`:e===`online`?`Online`:`Offline`}function I(e){if(e.length===0){x.innerHTML=`<p style="color:#8a8c8e;font-size:13px;padding:8px 0;">No friends yet. Search players above to add friends!</p>`;return}x.innerHTML=e.map(e=>`
                <div class="friend-card" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'" 
style="cursor:pointer;">
          <div class="avatar-with-status">
            <div class="friend-avatar">${e.username.charAt(0).toUpperCase()}</div>
            <div class="status-dot ${e.status}"></div>
          </div>
          <div class="friend-info">
            <div class="friend-name">${e.username}</div>
            <div class="friend-status ${e.status}">${F(e.status)}</div>
          </div>
          <div class="friend-actions" onclick="event.stopPropagation()">
            <button class="friend-action-btn" title="Remove Friend" onclick="window._removeFriend('${e.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `).join(``)}async function L(e){if(e.length===0){S.innerHTML=``;return}S.innerHTML=`<div style="font-size:13px;color:#8a8c8e;margin-bottom:8px;">Friend Requests</div><div class="friend-requests">`+e.map(e=>`
          <div class="friend-request-card">
            <div class="search-avatar">${e.fromUsername?.charAt(0).toUpperCase()||`?`}</div>
            <span class="search-username">${e.fromUsername||`Unknown`}</span>
            <div class="request-actions">
              <button class="request-accept-btn" onclick="window._acceptRequest('${e.id}','${e.from}','${e.to}')">Accept</button>
              <button class="request-decline-btn" onclick="window._declineRequest('${e.id}')">Decline</button>
            </div>
          </div>
        `).join(``)+`</div>`}window._acceptRequest=async(e,t,n)=>{await h(e,t,n),R()},window._declineRequest=async e=>{await d(e),R()},window._removeFriend=async e=>{confirm(`Remove this friend?`)&&(await f(T,e),R())};async function R(){if(!T)return;let[n,r]=await Promise.all([u(T),p(T)]),i=await P(n);for(let n of r)try{let r=await t(e(a,`users`,n.from));n.fromUsername=r.exists()?r.data().username:`Unknown`}catch{n.fromUsername=`Unknown`}I(i),L(r)}function z(e){k&&k!==e&&k.classList.remove(`open`),e.classList.toggle(`open`),k=e.classList.contains(`open`)?e:null}r(o,async r=>{if(D&&=(D(),null),O&&=(O.goOffline(),null),r){T=r.uid;let o=r.displayName||`Player`,s=0;try{let n=await t(e(a,`users`,r.uid));if(n.exists()){let e=n.data();o=e.username||o,s=e.bux||0}}catch{}O=n(r.uid);let c=o.charAt(0).toUpperCase();_.innerHTML=A(),document.getElementById(`friendSearchInput`).addEventListener(`input`,j);let l=`buxValue`;v.innerHTML=`
          <button class="create-btn" onclick="window.location.href='/bloxverse/create.html'">✨ Create</button>
          <div class="user-info">
            <button class="bux-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
              </svg>
              <span id="${l}">${s.toLocaleString()}</span>
            </button>
            <div class="avatar-dropdown" id="userDropdown">
              <div class="avatar-circle">${c}</div>
              <div class="dropdown-menu">
                <div class="dropdown-header">
                  <span class="dropdown-name">${o}</span>
                  <span class="dropdown-email">${r.email}</span>
                </div>
                <button class="dropdown-item" onclick="window.location.href='/bloxverse/profile.html'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
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
        `;let u=document.querySelector(`#userDropdown .avatar-circle`),d=document.getElementById(`userDropdown`);u.addEventListener(`click`,e=>{e.stopPropagation(),z(d)}),D=i(r.uid,e=>{let t=document.getElementById(l);t&&(t.textContent=e.toLocaleString())},o,r.email),b.style.display=`block`,R()}else T=null,_.innerHTML=``,v.innerHTML=`<button class="login-btn" 
onclick="window.location.href='/bloxverse/auth.html'">Login / Sign Up</button>`,b.style.display=`none`,k&&=(k.classList.remove(`open`),null)}),window._logout=async()=>{D&&=(D(),null),O&&=(O.goOffline(),null),await s(o),window.location.href=`/bloxverse/`},document.addEventListener(`click`,e=>{let t=document.getElementById(`friendSearchResults`);t&&!e.target.closest(`.friend-search-wrapper`)&&t.classList.remove(`visible`),k&&!k.contains(e.target)&&(k.classList.remove(`open`),k=null)});