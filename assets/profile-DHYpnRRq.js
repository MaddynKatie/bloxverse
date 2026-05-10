import"./modulepreload-polyfill-EeOZK34R.js";/* empty css             */import{N as e,S as t,g as n,n as r,t as i,v as a}from"./firebase-FzcSUUQW.js";/* empty css             */var o=document.getElementById(`navRight`),s=document.getElementById(`profilePage`),c=new URLSearchParams(window.location.search).get(`user`);n(i,async n=>{if(!n){window.location.href=`/bloxverse/auth.html`;return}let i=c||n.uid,a=i===n.uid,l=await t(e(r,`users`,i));if(!l.exists()){s.innerHTML=`<p style="text-align:center;color:#8a8c8e;padding:48px;">User not found</p>`;return}let u=l.data(),d=u.username||`Unknown`,f=u.email||``,p=u.bux||0,m=u.friends||[],h=u.followers||[],g=u.following||[],_=u.createdAt?new Date(u.createdAt).toLocaleDateString():`Unknown`,v=await t(e(r,`presence`,i)),y=`offline`;v.exists()&&(y=v.data().inGame?`in-game`:`online`);let b=d.charAt(0).toUpperCase(),x=[];for(let n of m.slice(0,12))try{let i=await t(e(r,`users`,n));if(i.exists()){let e=i.data();x.push({id:n,username:e.username||`Unknown`})}}catch{}let S=[];for(let n of h.slice(0,12))try{let i=await t(e(r,`users`,n));if(i.exists()){let e=i.data();S.push({id:n,username:e.username||`Unknown`})}}catch{}s.innerHTML=`
         <a href="/bloxverse/" class="profile-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          ${a?`Back to home`:`Back`}
        </a>

        <div class="profile-banner">
          <div class="avatar-with-status">
            <div class="profile-avatar-large">${b}</div>
            <div class="status-dot ${y}"></div>
          </div>
          <div class="profile-info">
            <h1>${d}</h1>
            <div class="profile-email">${a?f:``}</div>
          </div>
        </div>

        <div class="profile-stats">
          <div class="profile-stat-card">
            <div class="stat-value">${p.toLocaleString()}</div>
            <div class="stat-label">Bux</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${m.length}</div>
            <div class="stat-label">Friends</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${h.length}</div>
            <div class="stat-label">Followers</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${g.length}</div>
            <div class="stat-label">Following</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${_}</div>
            <div class="stat-label">Joined</div>
          </div>
        </div>

        <div class="profile-section">
          <h2>Friends</h2>
          ${x.length===0?`<div class="empty">No friends yet</div>`:`
            <div class="profile-friends-grid">
              ${x.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>

        <div class="profile-section">
          <h2>Followers</h2>
          ${S.length===0?`<div class="empty">No followers yet</div>`:`
            <div class="profile-friends-grid">
              ${S.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>
      `;let C=a?u:await t(e(r,`users`,n.uid)).then(e=>e.exists()?e.data():{}),w=C.bux||0,T=(C.username||`P`).charAt(0).toUpperCase();o.innerHTML=`
        <div class="user-info">
          <button class="bux-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
            </svg>
            <span>${w.toLocaleString()}</span>
          </button>
          <div class="avatar-dropdown">
            <div class="avatar-circle">${T}</div>
            <div class="dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-name">${C.username||`Player`}</span>
                <span class="dropdown-email">${n.email}</span>
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
      `;let E=o.querySelector(`.avatar-circle`),D=o.querySelector(`.avatar-dropdown`);E.addEventListener(`click`,e=>{e.stopPropagation(),D.classList.toggle(`open`)}),document.addEventListener(`click`,e=>{D.contains(e.target)||D.classList.remove(`open`)})}),window._logout=async()=>{await a(i),window.location.href=`/bloxverse/auth.html`};