/* ===== GetSkill 前端逻辑：拉取 skills.json、搜索、渲染 ===== */
(function () {
  'use strict';

  var DATA_URL = 'data/skills.json';

  /** HTML 转义，防止元数据注入 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 字节数转可读大小 */
  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function loadSkills() {
    return fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (Array.isArray(data)) {
          // 兼容 [{ skills: [...] }] 包装结构
          if (data.length === 1 && data[0] && Array.isArray(data[0].skills)) {
            return data[0].skills;
          }
          return data;
        }
        return data.skills || [];
      });
  }

  function tagsHtml(tags) {
    return (tags || [])
      .map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; })
      .join('');
  }

  /* ================= 首页：列表 + 搜索 + 分类 ================= */
  function initIndex(skills) {
    var grid = document.getElementById('skill-grid');
    var empty = document.getElementById('empty-state');
    var count = document.getElementById('result-count');
    var input = document.getElementById('search-input');
    var chipsBox = document.getElementById('category-chips');

    var state = { q: '', category: '全部' };

    // 分类 chips
    var categories = ['全部'];
    skills.forEach(function (s) {
      if (s.category && categories.indexOf(s.category) === -1) {
        categories.push(s.category);
      }
    });
    chipsBox.innerHTML = categories
      .map(function (c) {
        return '<button class="chip' + (c === '全部' ? ' active' : '') +
          '" data-category="' + esc(c) + '">' + esc(c) + '</button>';
      })
      .join('');

    chipsBox.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      state.category = btn.dataset.category;
      chipsBox.querySelectorAll('.chip').forEach(function (el) {
        el.classList.toggle('active', el === btn);
      });
      render();
    });

    input.addEventListener('input', function () {
      state.q = input.value.trim().toLowerCase();
      render();
    });

    function matches(s) {
      if (state.category !== '全部' && s.category !== state.category) return false;
      if (!state.q) return true;
      var hay = [s.name, s.id, s.description, s.author, s.category]
        .concat(s.tags || [])
        .join(' ')
        .toLowerCase();
      return hay.indexOf(state.q) !== -1;
    }

    function cardHtml(s) {
      var url = 'skill.html?id=' + encodeURIComponent(s.id);
      return (
        '<article class="skill-card">' +
          '<div class="card-top">' +
            '<h3><a href="' + url + '">' + esc(s.name) + '</a></h3>' +
            '<span class="badge">' + esc(s.category || '未分类') + '</span>' +
          '</div>' +
          '<p class="desc">' + esc(s.description) + '</p>' +
          '<div class="tag-row">' + tagsHtml(s.tags) + '</div>' +
          '<div class="card-footer">' +
            '<span>v' + esc(s.version) + ' · ' + fmtSize(s.size) + '</span>' +
            '<a class="btn btn-primary btn-sm" href="' + esc(s.file) + '" download>下载</a>' +
          '</div>' +
        '</article>'
      );
    }

    function render() {
      var list = skills.filter(matches);
      grid.innerHTML = list.map(cardHtml).join('');
      empty.hidden = list.length > 0;
      count.textContent = '共 ' + list.length + ' 个技能';
    }

    render();
  }

  /* ================= 详情页 ================= */
  function initSkill(skills) {
    var id = new URLSearchParams(location.search).get('id');
    var skill = null;
    for (var i = 0; i < skills.length; i++) {
      if (skills[i].id === id) { skill = skills[i]; break; }
    }

    var box = document.getElementById('skill-detail');
    if (!skill) {
      document.getElementById('not-found').hidden = false;
      return;
    }

    document.title = skill.name + ' - GetSkill';

    box.innerHTML =
      '<div class="detail-card">' +
        '<div class="detail-head">' +
          '<div>' +
            '<h1>' + esc(skill.name) + '</h1>' +
            '<div class="tag-row" style="margin-top:8px">' +
              '<span class="badge">' + esc(skill.category || '未分类') + '</span>' +
              tagsHtml(skill.tags) +
            '</div>' +
          '</div>' +
          '<a class="btn btn-primary" href="' + esc(skill.file) + '" download>⬇ 下载技能包 (' + fmtSize(skill.size) + ')</a>' +
        '</div>' +
        '<p class="detail-desc">' + esc(skill.description) + '</p>' +
        '<div class="meta-grid">' +
          '<div class="meta-item"><span class="label">版本</span><span class="value">v' + esc(skill.version) + '</span></div>' +
          '<div class="meta-item"><span class="label">作者</span><span class="value">' + esc(skill.author || '佚名') + '</span></div>' +
          '<div class="meta-item"><span class="label">更新日期</span><span class="value">' + esc(skill.updated || '—') + '</span></div>' +
          '<div class="meta-item"><span class="label">文件大小</span><span class="value">' + fmtSize(skill.size) + '</span></div>' +
        '</div>' +
        '<p class="install-hint">使用方法：下载并解压，将 <code>' + esc(skill.id) + '/</code> 文件夹放入你的 Agent <code>skills</code> 目录即可。</p>' +
        (skill.readme
          ? '<div class="readme-block"><h2>SKILL.md 预览</h2><pre>' + esc(skill.readme) + '</pre></div>'
          : '') +
      '</div>';
  }

  /* ================= 入口 ================= */
  loadSkills()
    .then(function (skills) {
      var page = document.body.dataset.page;
      if (page === 'skill') initSkill(skills);
      else initIndex(skills);
    })
    .catch(function (err) {
      console.error('加载 skills.json 失败:', err);
      var target = document.getElementById('skill-grid') || document.getElementById('skill-detail');
      if (target) {
        target.innerHTML = '<div class="empty-state"><p>⚠️ 技能数据加载失败，请刷新重试。</p></div>';
      }
    });
})();