import"./modulepreload-polyfill-CXK8biUa.js";/* empty css             */import{_ as e,n as t,s as n,t as r,x as i,y as a}from"./firebase-BGgYK--4.js";/* empty css             */var o=document.getElementById(`navRight`),s=document.getElementById(`profilePage`),c=new URLSearchParams(window.location.search).get(`user`);a(r,async r=>{if(!r){window.location.href=`/auth.html`;return}let i=c||r.uid,a=i===r.uid,l=await n(e(t,`users`,i));if(!l.exists()){s.innerHTML=`<p style="text-align:center;color:#8a8c8e;padding:48px;">User not found</p>`;return}let u=l.data(),d=u.username||`Unknown`,f=u.email||``,p=u.bux||0,m=u.friends||[],h=u.createdAt?new Date(u.createdAt).toLocaleDateString():`Unknown`,g=await n(e(t,`presence`,i)),_=`offline`;g.exists()&&(_=g.data().inGame?`in-game`:`online`);let v=d.charAt(0).toUpperCase(),y=[];for(let r of m.slice(0,12))try{let i=await n(e(t,`users`,r));i.exists()&&y.push(i.data())}catch{}s.innerHTML=`
        <a href="/index.html" class="profile-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          ${a?`Back to home`:`Back`}
        </a>

        <div class="profile-banner">
          <div class="avatar-with-status">
            <div class="profile-avatar-large">${v}</div>
            <div class="status-dot ${_}"></div>
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
            <div class="stat-value">${h}</div>
            <div class="stat-label">Joined</div>
          </div>
        </div>

        <div class="profile-section">
          <h2>Friends</h2>
          ${y.length===0?`<div class="empty">No friends yet</div>`:`
            <div class="profile-friends-grid">
              ${y.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>
      `;let b=a?u:await n(e(t,`users`,r.uid)).then(e=>e.exists()?e.data():{}),x=b.bux||0,S=(b.username||`P`).charAt(0).toUpperCase();o.innerHTML=`
        <div class="user-info">
          <button class="bux-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
            </svg>
            <span>${x.toLocaleString()}</span>
          </button>
          <div class="avatar-dropdown">
            <div class="avatar-circle">${S}</div>
            <div class="dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-name">${b.username||`Player`}</span>
                <span class="dropdown-email">${r.email}</span>
              </div>
              <button class="dropdown-item" onclick="window.location.href='/profile.html'">
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
      `;let C=o.querySelector(`.avatar-circle`),w=o.querySelector(`.avatar-dropdown`);C.addEventListener(`click`,e=>{e.stopPropagation(),w.classList.toggle(`open`)}),document.addEventListener(`click`,e=>{w.contains(e.target)||w.classList.remove(`open`)})}),window._logout=async()=>{await i(r),window.location.href=`/auth.html`};