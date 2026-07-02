/* ===== JAcoworks Website — JavaScript ===== */

(function () {
  'use strict';

  // ===== Mobile Navigation Toggle =====
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', function () {
      mobileMenu.classList.toggle('hidden');
    });
  }

  // ===== Platform Detection for Download Page =====
  const PLATFORM_LABELS = {
    'darwin-aarch64': 'macOS (Apple Silicon)',
    'darwin-x86_64': 'macOS (Intel)',
    'windows-x86_64': 'Windows (64-bit)',
    'linux-x86_64': 'Linux (AppImage)',
  };

  function readAvailableAssets() {
    var links = document.querySelectorAll('#all-platforms a[data-platform][href]');
    var assets = {};

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var platform = link.getAttribute('data-platform');
      var href = link.getAttribute('href');
      if (!platform || !href) continue;

      assets[platform] = {
        href: href,
        fileSize: link.getAttribute('data-file-size') || '',
      };
    }

    return assets;
  }

  function normalizeArchitecture(rawValue) {
    if (!rawValue) return 'unknown';
    var value = String(rawValue).toLowerCase();

    if (value.indexOf('arm') >= 0 || value.indexOf('aarch64') >= 0) {
      return 'arm64';
    }
    if (
      value.indexOf('x86') >= 0 ||
      value.indexOf('amd64') >= 0 ||
      value.indexOf('intel') >= 0
    ) {
      return 'x86_64';
    }
    return 'unknown';
  }

  function resolveMacPlatform(assets, architecture) {
    if (architecture === 'x86_64' && assets['darwin-x86_64']) return 'darwin-x86_64';
    if (architecture === 'arm64' && assets['darwin-aarch64']) return 'darwin-aarch64';
    if (assets['darwin-aarch64']) return 'darwin-aarch64';
    if (assets['darwin-x86_64']) return 'darwin-x86_64';
    return null;
  }

  async function detectClientPlatform() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';

    var info = {
      osFamily: 'unknown',
      architecture: 'unknown',
      platform: 'unknown',
      confidence: 'low',
    };

    if (/Windows/i.test(ua) || /Win/i.test(platform)) {
      info.osFamily = 'windows';
      info.architecture = 'x86_64';
      info.platform = 'windows-x86_64';
      info.confidence = 'medium';
    } else if (/Linux/i.test(ua) || /Linux/i.test(platform)) {
      info.osFamily = 'linux';
      info.architecture = 'x86_64';
      info.platform = 'linux-x86_64';
      info.confidence = 'medium';
    } else if (/Macintosh|Mac OS X|Mac/i.test(ua) || /Mac/i.test(platform)) {
      info.osFamily = 'darwin';
      if (/arm|aarch64/i.test(ua)) {
        info.architecture = 'arm64';
        info.platform = 'darwin-aarch64';
        info.confidence = 'medium';
      }
    }

    var uaData = navigator.userAgentData;
    if (uaData) {
      if (typeof uaData.platform === 'string') {
        var platformName = uaData.platform.toLowerCase();
        if (platformName.indexOf('mac') >= 0) info.osFamily = 'darwin';
        if (platformName.indexOf('win') >= 0) info.osFamily = 'windows';
        if (platformName.indexOf('linux') >= 0) info.osFamily = 'linux';
      }

      if (typeof uaData.getHighEntropyValues === 'function') {
        try {
          var entropy = await uaData.getHighEntropyValues(['architecture']);
          var architecture = normalizeArchitecture(entropy.architecture);
          if (architecture !== 'unknown') {
            info.architecture = architecture;
            info.confidence = 'high';
          }
        } catch (err) {
          // Ignore; fall back to low-confidence browser hints.
        }
      }
    }

    if (info.osFamily === 'darwin') {
      info.platform = info.architecture === 'x86_64' ? 'darwin-x86_64' : 'darwin-aarch64';
    }

    return info;
  }

  window.detectPlatformDownload = async function () {
    var detectedEl = document.getElementById('detected-platform');
    var btnTextEl = document.getElementById('primary-download-text');
    var btnEl = document.getElementById('primary-download-btn');
    var metaEl = document.getElementById('primary-download-meta');
    if (!detectedEl || !btnTextEl || !btnEl || !metaEl) return;

    var assets = readAvailableAssets();
    var info = await detectClientPlatform();

    var resolvedPlatform = null;
    if (info.platform !== 'unknown' && assets[info.platform]) {
      resolvedPlatform = info.platform;
    } else if (info.osFamily === 'darwin') {
      resolvedPlatform = resolveMacPlatform(assets, info.architecture);
    } else if (info.osFamily === 'windows' && assets['windows-x86_64']) {
      resolvedPlatform = 'windows-x86_64';
    } else if (info.osFamily === 'linux' && assets['linux-x86_64']) {
      resolvedPlatform = 'linux-x86_64';
    }

    if (resolvedPlatform) {
      var label = PLATFORM_LABELS[resolvedPlatform] || resolvedPlatform;
      var targetAsset = assets[resolvedPlatform];
      detectedEl.textContent = '检测到您的系统: ' + label;
      btnTextEl.textContent = '下载 ' + label + ' 版';
      btnEl.setAttribute('href', targetAsset.href);
      metaEl.textContent = targetAsset.fileSize
        ? '安装包大小：' + targetAsset.fileSize
        : '';
      return;
    }

    btnEl.setAttribute('href', '#all-platforms');
    btnTextEl.textContent = '查看所有版本';
    metaEl.textContent = '';

    if (info.osFamily === 'windows') {
      detectedEl.textContent = '检测到 Windows，请从下方选择可用安装包';
      return;
    }

    if (info.osFamily === 'linux') {
      detectedEl.textContent = '检测到 Linux，请从下方选择可用安装包';
      return;
    }

    detectedEl.textContent = '未能检测到您的系统，请从下方选择';
  };

  // ===== Toast Notification System =====
  window.showToast = function (message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);

    // Auto-remove after 4s
    setTimeout(function () {
      toast.classList.add('toast-out');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, 4000);
  };

  // ===== HTMX Event Handlers =====
  document.addEventListener('htmx:afterRequest', function (evt) {
    var xhr = evt.detail.xhr;
    if (!xhr) return;

    // Show toast for successful mutations
    if (xhr.status >= 200 && xhr.status < 300) {
      var trigger = evt.detail.elt;
      if (trigger && trigger.tagName === 'FORM') {
        showToast('操作成功', 'success');
      }
    }
  });

  document.addEventListener('htmx:responseError', function (evt) {
    var xhr = evt.detail.xhr;
    var msg = '操作失败';
    if (xhr && xhr.status === 403) msg = '权限不足';
    if (xhr && xhr.status === 404) msg = '资源不存在';
    if (xhr && xhr.status >= 500) msg = '服务器错误';
    showToast(msg, 'error');
  });

  // Close modal/form after successful HTMX swap (if response contains a trigger header)
  document.addEventListener('htmx:afterSwap', function (evt) {
    // Close any open mobile menus after navigation
    if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
      mobileMenu.classList.add('hidden');
    }
  });

})();
