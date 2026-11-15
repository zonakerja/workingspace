/**
 * Jembatan Akasha untuk plugin AI resmi ONLYOFFICE (dipasang saat build image, infra/onlyoffice/Dockerfile).
 *
 * Plugin AI punya mode "pengaturan dari server" (`Asc.plugin.info.aiPluginSettings` → `AI.serverSettings`): provider,
 * model, dan aksi ditetapkan dari luar, tombol Settings disembunyikan, dan semua permintaan dikirim ke satu alamat proxy.
 * Server ONLYOFFICE hanya bisa mengisi mode ini untuk seluruh server, jadi jembatan ini mengisinya per user dari opsi
 * plugin di config editor bertanda tangan Akasha (`editorConfig.plugins.options[GUID].akasha`): provider "AI Akasha"
 * dengan key = token sesi AI pendek, proxy = backend Akasha (`/api/v1/office/ai/proxy`). Backend memakai provider & API
 * key user di Pengaturan → AI — tidak ada key yang diisi di editor. Tanpa opsi Akasha, plugin berjalan seperti aslinya.
 */
(function () {
  "use strict";

  var PROVIDER = "AI Akasha";

  window.akashaApplyAiSettings = function () {
    var plugin = window.Asc && window.Asc.plugin;
    var info = plugin && plugin.info;
    var akasha = info && info.options && info.options.akasha;
    var AI = window.AI;
    if (!akasha || !akasha.token || !akasha.proxy || !akasha.url || !AI) return;

    var model = {
      id: akasha.modelId,
      object: "model",
      created: 0,
      owned_by: "akasha",
      name: akasha.modelName,
      endpoints: [AI.Endpoints.Types.v1.Chat_Completions],
      options: { max_input_tokens: AI.InputMaxTokens["128k"] },
    };
    var providers = {};
    providers[PROVIDER] = { name: PROVIDER, url: akasha.url, key: akasha.token, models: [model] };

    // Semua aksi teks & gambar-masukan memakai AI Akasha; pembuatan gambar belum didukung backend
    var actions = {};
    var keys = AI.ActionsGetKeys ? AI.ActionsGetKeys() : ["Chat", "Summarization", "Translation", "TextAnalyze", "OCR", "Vision"];
    for (var i = 0; i < keys.length; i++) {
      actions[keys[i]] = { model: keys[i] === "ImageGeneration" ? "" : akasha.modelId };
    }

    info.aiPluginSettings = JSON.stringify({
      version: AI.Storage.Version,
      proxy: akasha.proxy,
      providers: providers,
      models: [
        {
          id: akasha.modelId,
          name: akasha.modelName,
          provider: PROVIDER,
          capabilities: AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Vision,
        },
      ],
      actions: actions,
      customProviders: {},
    });
  };
})();
