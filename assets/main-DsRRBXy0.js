import{a as e,c as t,i as n,l as r,n as i,s as a,t as o}from"./friends-8s15ntHU.js";import"./modulepreload-polyfill-CXK8biUa.js";/* empty css             */import{t as s}from"./games-DdxpaqPp.js";import{E as c,S as l,d as u,n as d,o as f,s as p,t as m,w as h}from"./firebase-oY_yUpcG.js";var g=document.getElementById(`navCenter`),_=document.getElementById(`navRight`),v=document.getElementById(`gameGrid`),y=document.getElementById(`friendsSection`),b=document.getElementById(`friendsGrid`),x=document.getElementById(`friendRequests`);function S(e){let t=document.createElement(`div`);t.className=`game-card`,t.onclick=()=>C(e.id),t.innerHTML=`
        <div class="game-thumbnail">
          <img src="${e.icon}" alt="${e.name}" />
          <div class="play-overlay">
            <div class="play-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
        <div class="game-info">
          <h3>${e.name}</h3>
        </div>
      `,v.appendChild(t)}s.forEach(S);function C(e){let t=document.getElementById(`loadingScreen`),n=document.getElementById(`loadingBarFill`),r=document.getElementById(`loadingTitle`);r.textContent=`Loading `+(s.find(t=>t.id===e)?.name||`experience`)+`...`,t.style.display=`flex`;let i=0,a=setInterval(()=>{i+=Math.random()*15,i>=100&&(i=100,clearInterval(a),window.location.href=`/bloxverse/game.html?game=`+e),n.style.width=i+`%`},200)}window.launchGame=C;var w=null,T=new Set,E=null,D=null,O=null;function k(){return`
        <div class="friend-search-wrapper">
          <div class="friend-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" id="friendSearchInput" placeholder="Search players" autocomplete="off" />
          </div>
        </div>
      `}document.addEventListener(`keydown`,e=>{if(e.key===`/`&&document.activeElement?.id!==`friendSearchInput`&&(e.preventDefault(),document.getElementById(`friendSearchInput`)?.focus()),e.key===`Enter`&&document.activeElement?.id===`friendSearchInput`){let e=document.getElementById(`friendSearchInput`).value.trim();e.length>=3&&(window.location.href=`/bloxverse/search.html?q=${encodeURIComponent(e)}`)}});async function A(e){let n=e.target.value.trim(),r=document.getElementById(`friendSearchResults`);if(n.length<3){r.classList.remove(`visible`);return}let i=await t(n);i.length===0?r.innerHTML=`<div style="padding:12px;color:#8a8c8e;font-size:13px;">No players found</div>`:r.innerHTML=i.map(e=>`
          <div class="search-result-item">
            <div class="search-user-info">
              <div class="search-avatar">${e.username.charAt(0).toUpperCase()}</div>
              <span class="search-username">${e.username}</span>
            </div>
            ${e.id===w?``:T.has(e.id)?`<span class="add-friend-btn sent">Sent</span>`:`<button class="add-friend-btn" onclick="window._addFriend('${e.id}','${e.username}',this)">+ Add</button>`}
          </div>
        `).join(``),r.classList.add(`visible`)}async function j(e,t,n){try{await r(w,e,t),T.add(e),n.textContent=`Sent`,n.classList.add(`sent`),n.onclick=null}catch(e){console.error(e)}}window._addFriend=j;async function M(e){try{let t=await u(l(d,`presence`,e));if(t.exists()){let e=t.data();if(e.inGame)return`in-game`;if(e.online)return`online`}}catch{}return`offline`}async function N(e){let t=await Promise.all(e.map(e=>M(e.id)));return e.map((e,n)=>({...e,status:t[n]}))}function P(e){return e===`in-game`?`In Game`:e===`online`?`Online`:`Offline`}function F(e){if(e.length===0){b.innerHTML=`<p style="color:#8a8c8e;font-size:13px;padding:8px 0;">No friends yet. Search players above to add friends!</p>`;return}b.innerHTML=e.map(e=>`
                <div class="friend-card" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'" 
style="cursor:pointer;">
          <div class="avatar-with-status">
            <div class="friend-avatar">${e.username.charAt(0).toUpperCase()}</div>
            <div class="status-dot ${e.status}"></div>
          </div>
          <div class="friend-info">
            <div class="friend-name">${e.username}</div>
            <div class="friend-status ${e.status}">${P(e.status)}</div>
          </div>
          <div class="friend-actions" onclick="event.stopPropagation()">
            <button class="friend-action-btn" title="Remove Friend" onclick="window._removeFriend('${e.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `).join(``)}async function I(e){if(e.length===0){x.innerHTML=``;return}x.innerHTML=`<div style="font-size:13px;color:#8a8c8e;margin-bottom:8px;">Friend Requests</div><div class="friend-requests">`+e.map(e=>`
          <div class="friend-request-card">
            <div class="search-avatar">${e.fromUsername?.charAt(0).toUpperCase()||`?`}</div>
            <span class="search-username">${e.fromUsername||`Unknown`}</span>
            <div class="request-actions">
              <button class="request-accept-btn" onclick="window._acceptRequest('${e.id}','${e.from}','${e.to}')">Accept</button>
              <button class="request-decline-btn" onclick="window._declineRequest('${e.id}')">Decline</button>
            </div>
          </div>
        `).join(``)+`</div>`}window._acceptRequest=async(e,t,n)=>{await o(e,t,n),L()},window._declineRequest=async e=>{await i(e),L()},window._removeFriend=async e=>{confirm(`Remove this friend?`)&&(await a(w,e),L())};async function L(){if(!w)return;let[t,r]=await Promise.all([e(w),n(w)]),i=await N(t);for(let e of r)try{let t=await u(l(d,`users`,e.from));e.fromUsername=t.exists()?t.data().username:`Unknown`}catch{e.fromUsername=`Unknown`}F(i),I(r)}function R(e){O&&O!==e&&O.classList.remove(`open`),e.classList.toggle(`open`),O=e.classList.contains(`open`)?e:null}h(m,async e=>{if(E&&=(E(),null),D&&=(D.goOffline(),null),e){w=e.uid;let t=e.displayName||`Player`,n=0;try{let r=await u(l(d,`users`,e.uid));if(r.exists()){let e=r.data();t=e.username||t,n=e.bux||0}}catch{}D=p(e.uid);let r=t.charAt(0).toUpperCase();g.innerHTML=k(),document.getElementById(`friendSearchInput`).addEventListener(`input`,A);let i=`buxValue`;_.innerHTML=`
          <button class="create-btn" onclick="window.location.href='/bloxverse/create.html'">✨ Create</button>
          <div class="user-info">
            <button class="bux-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
              </svg>
              <span id="${i}">${n.toLocaleString()}</span>
            </button>
            <div class="avatar-dropdown" id="userDropdown">
              <div class="avatar-circle">${r}</div>
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
                <button class="dropdown-item" onclick="window.location.href='/bloxverse/create.html'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Create Scripts
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
        `;let a=document.querySelector(`#userDropdown .avatar-circle`),o=document.getElementById(`userDropdown`);a.addEventListener(`click`,e=>{e.stopPropagation(),R(o)}),E=f(e.uid,e=>{let t=document.getElementById(i);t&&(t.textContent=e.toLocaleString())},t,e.email),y.style.display=`block`,L()}else w=null,g.innerHTML=``,_.innerHTML=`<button class="login-btn" 
onclick="window.location.href='/bloxverse/auth.html'">Login / Sign Up</button>`,y.style.display=`none`,O&&=(O.classList.remove(`open`),null)}),window._logout=async()=>{E&&=(E(),null),D&&=(D.goOffline(),null),await c(m),window.location.href=`/bloxverse/`},document.addEventListener(`click`,e=>{let t=document.getElementById(`friendSearchResults`);t&&!e.target.closest(`.friend-search-wrapper`)&&t.classList.remove(`visible`),O&&!O.contains(e.target)&&(O.classList.remove(`open`),O=null)});