(function () {
        var HOME_TOP = "#F6E8E4";
        var DEFAULT_TOP = "#FBF7F5";
        var CLIENT_PATHS = ["/login", "/agenda", "/app", "/cliente", "/agenda-legado"];
        var CLIENT_VIEWPORT = "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
        var DEFAULT_VIEWPORT = "width=device-width, initial-scale=1.0, viewport-fit=cover";
        var observer = null;

        function isClientPath() {
          return CLIENT_PATHS.indexOf(window.location.pathname) !== -1;
        }

        var lastTopColor = null;

        function toHex(color) {
          var m = color && color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
          if (!m) return null;
          var alpha = m[4] === undefined ? 1 : (m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
          if (alpha < 0.9) return null;
          return "#" + [m[1], m[2], m[3]].map(function (v) { return ("0" + Math.round(Number(v)).toString(16)).slice(-2); }).join("").toUpperCase();
        }

        // Cor real no topo da tela (primeiro fundo opaco sob a barra do celular),
        // para a barra ficar exatamente da cor da aba aberta — nos dois temas.
        function sampleTopColor() {
          if (!document.elementFromPoint || !document.body) return null;
          var el = document.elementFromPoint(Math.round(window.innerWidth / 2), 1);
          // Para antes de #root/body: o fundo deles é pintado por este próprio script.
          while (el && el.id !== "root" && el !== document.body && el !== document.documentElement) {
            var cs = window.getComputedStyle(el);
            if (cs.backgroundImage && cs.backgroundImage !== "none") {
              var first = toHex((cs.backgroundImage.match(/rgba?\([^)]*\)/) || [])[0]);
              if (first) return first;
            }
            var solid = toHex(cs.backgroundColor);
            if (solid) return solid;
            el = el.parentElement;
          }
          return null;
        }

        function resolveTopColor() {
          if (window.location.pathname === "/login") return DEFAULT_TOP;
          // Rolando no meio da página, mantém a cor da aba (evita a barra piscar).
          if (lastTopColor && window.scrollY > 8) return lastTopColor;
          var sampled = sampleTopColor();
          if (sampled) return (lastTopColor = sampled);
          if (lastTopColor) return lastTopColor;
          // Modo escuro do app da cliente (src/lib/temaCliente.ts).
          if (document.documentElement.getAttribute("data-tema-cliente") === "escuro") return "#111013";
          var root = document.getElementById("root");
          if (root && root.querySelector(".sl-home-header")) return HOME_TOP;
          if (root && root.querySelector(".sl-tab")) return DEFAULT_TOP;
          return HOME_TOP;
        }

        function syncClientChrome() {
          var client = isClientPath();
          var viewport = document.querySelector('meta[name="viewport"]');
          if (viewport) viewport.setAttribute("content", client ? CLIENT_VIEWPORT : DEFAULT_VIEWPORT);

          if (client) document.documentElement.setAttribute("data-sra-client", "true");
          else document.documentElement.removeAttribute("data-sra-client");

          var admin = window.location.pathname.indexOf("/admin") === 0;
          if (admin) document.documentElement.setAttribute("data-sra-admin", "true");
          else document.documentElement.removeAttribute("data-sra-admin");

          if (!client) return;

          var color = resolveTopColor();
          document.documentElement.style.setProperty("--sra-client-top", color);
          document.documentElement.style.backgroundColor = color;
          document.documentElement.style.height = "auto";
          document.documentElement.style.overflowY = "auto";
          document.documentElement.style.touchAction = "pan-y";

          var theme = document.querySelector('meta[name="theme-color"]');
          if (theme) theme.setAttribute("content", color);

          if (document.body) {
            document.body.style.margin = "0";
            document.body.style.backgroundColor = color;
            document.body.style.height = "auto";
            document.body.style.maxHeight = "none";
            document.body.style.overflowY = "auto";
            document.body.style.position = "static";
            document.body.style.touchAction = "pan-y";
            document.body.style.webkitOverflowScrolling = "touch";
          }

          var root = document.getElementById("root");
          if (root) {
            root.style.backgroundColor = color;
            root.style.height = "auto";
            root.style.maxHeight = "none";
            root.style.overflow = "visible";
          }
        }

        function observeClientUi() {
          var root = document.getElementById("root");
          if (!root || observer) return;
          observer = new MutationObserver(function () {
            window.requestAnimationFrame(syncClientChrome);
          });
          observer.observe(root, { childList: true, subtree: true });
        }

        document.addEventListener("gesturestart", function (event) {
          if (isClientPath()) event.preventDefault();
        }, { passive: false });

        // Aplica o tema salvo antes do primeiro desenho para evitar flash claro.
        // Cliente e Admin mantêm preferências independentes.
        (function aplicarTemaInicial() {
          try {
            if (window.location.pathname.indexOf("/admin") === 0) {
              var adminTheme = localStorage.getItem("sra-luck-theme") || "light";
              var adminDark = adminTheme === "dark";
              document.documentElement.classList.toggle("dark", adminDark);
              document.documentElement.style.colorScheme = adminDark ? "dark" : "light";
              var adminMeta = document.querySelector('meta[name="theme-color"]');
              if (adminMeta) adminMeta.setAttribute("content", adminDark ? "#0F1014" : "#F6E8E4");
              return;
            }
            if (!isClientPath() || window.location.pathname === "/login") return;
            var pref = localStorage.getItem("sra-luck-tema-cliente") || "claro";
            var escuro = pref === "escuro" || (pref === "sistema" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
            document.documentElement.setAttribute("data-tema-cliente", escuro ? "escuro" : "claro");
          } catch (e) {}
        })();

        syncClientChrome();
        document.addEventListener("DOMContentLoaded", function () {
          syncClientChrome();
          observeClientUi();
        });
        window.addEventListener("pageshow", syncClientChrome);
        window.addEventListener("app:navigate", function () {
          syncClientChrome();
          observeClientUi();
        });
        window.addEventListener("focus", syncClientChrome);
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) syncClientChrome();
        });
      })();

      window.__sraLuckBeforeInstallPrompt = window.__sraLuckBeforeInstallPrompt || null;

      window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        window.__sraLuckBeforeInstallPrompt = event;
        window.dispatchEvent(new Event("sra-luck-pwa-ready"));
      });

      window.addEventListener("appinstalled", function () {
        window.__sraLuckBeforeInstallPrompt = null;
        try {
          localStorage.setItem("sra-luck-pwa-installed-v2", "true");
          localStorage.setItem("sra-luck-push-after-install", "pending");
          localStorage.removeItem("sra-luck-pwa-install-dismissed-date-v3");
        } catch (_) {}
        window.dispatchEvent(new Event("sra-luck-pwa-installed"));
      });

      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker
            .register("/simulador-iphone-sw.js", { scope: "/", updateViaCache: "none" })
            .then(function (registration) {
              return registration.update().catch(function () {});
            })
            .catch(function () {});
        });
      }
