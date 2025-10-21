/* =======================================================
   LenAI 3.4 — mais robusto: tradução, imagens, persistência e proteção contra crashes
   ======================================================= */

try {
  let historico = JSON.parse(localStorage.getItem("lenai_historico")) || [];
  let chatAtivo = 0;
  let keys = JSON.parse(localStorage.getItem("lenai_keys")) || { openai: "", gemini: "", claude: "" };
  let tema = localStorage.getItem("lenai_tema") || "escuro";
  document.body.classList.toggle("claro", tema === "claro");

  /* Segurança: garante formato mínimo do histórico */
  if (!Array.isArray(historico)) historico = [{ titulo: "Novo Chat", mensagens: [] }];

  /* Markdown */
  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  } else {
    console.warn("marked não encontrado — markdown ficará simples.");
  }

  /* ===== Helpers ===== */
  function salvarLocal() {
    try {
      localStorage.setItem("lenai_historico", JSON.stringify(historico));
    } catch (e) {
      console.error("Erro ao salvar localStorage:", e);
    }
  }
  function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* ===== Histórico UI ===== */
  function atualizarHistorico() {
    const ul = document.getElementById("historico");
    if (!ul) return console.warn("Elemento #historico não encontrado");
    ul.innerHTML = "";

    for (let i = historico.length - 1; i >= 0; i--) {
      const conv = historico[i] || {};
      const li = document.createElement("li");

      const del = document.createElement("span");
      del.className = "del";
      del.textContent = "✖️";
      del.title = "Excluir conversa";

      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm("Tem certeza que deseja excluir esta conversa?")) {
          historico.splice(i, 1);
          if (historico.length === 0) novoChat();
          salvarLocal();
          atualizarHistorico();
        }
      };

      li.textContent = conv.titulo || `Chat ${i + 1}`;
      li.appendChild(del);
      li.onclick = () => abrirConversa(i);
      li.ondblclick = (e) => {
        e.stopPropagation();
        ativarEdicaoTitulo(li, i);
      };

      if (i === chatAtivo) li.classList.add("ativo");
      ul.appendChild(li);
    }

    if (historico.length > 1) {
      const limparBtn = document.createElement("button");
      limparBtn.textContent = "🧹 Limpar histórico";
      limparBtn.style.marginTop = "10px";
      limparBtn.onclick = limparHistorico;
      ul.appendChild(limparBtn);
    }
  }

  /* ===== Carregar/Renderizar Chat (repara imagens salvas) ===== */
  function carregarChat(i) {
    chatAtivo = i;
    const chat = document.getElementById("chat");
    if (!chat) return console.warn("Elemento #chat não encontrado");
    chat.innerHTML = "";

    const conv = historico[i] || { mensagens: [] };
    const msgs = Array.isArray(conv.mensagens) ? conv.mensagens : [];

    msgs.forEach((m) => {
      const div = document.createElement("div");
      div.className = (m.role || "bot") + " msg";

      const text = m.text || "";

      // detecta markdown de imagem: ![alt](url)
      const mdImgMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (mdImgMatch) {
        const alt = mdImgMatch[1] || "";
        const url = mdImgMatch[2] || "";
        div.innerHTML = `
          <div style="text-align:center">
            <b>🖼️ ${escapeHtml(alt)}</b><br>
            <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"
                 style="max-width:70%;height:auto;border-radius:14px;display:block;margin:10px auto;box-shadow:0 4px 20px rgba(0,0,0,0.35);object-fit:cover;">
          </div>
        `;
      } else {
        // texto normal — se for bot, usa markdown (se disponível)
        if (m.role === "bot" && typeof marked !== "undefined") {
          try {
            div.innerHTML = marked.parse(text);
          } catch {
            div.innerHTML = escapeHtml(text);
          }
        } else {
          div.innerHTML = m.role === "user" ? escapeHtml(text) : escapeHtml(text);
        }
      }

      chat.appendChild(div);
    });

    chat.scrollTop = chat.scrollHeight;
    atualizarHistorico();
  }

  function abrirConversa(i) {
    const chatSelecionado = historico.splice(i, 1)[0];
    historico.push(chatSelecionado || { titulo: "Novo Chat", mensagens: [] });
    chatAtivo = historico.length - 1;
    salvarLocal();
    carregarChat(chatAtivo);
  }

  function novoChat() {
    historico.push({ titulo: "Novo Chat", mensagens: [] });
    chatAtivo = historico.length - 1;
    salvarLocal();
    atualizarHistorico();
    const chat = document.getElementById("chat");
    if (chat) chat.innerHTML = '<div class="bot msg">✨ Novo chat iniciado. Como posso ajudar?</div>';
  }

  function limparHistorico() {
    if (confirm("Tem certeza que deseja apagar TODO o histórico de conversas??")) {
      historico = [];
      salvarLocal();
      novoChat();
    }
  }

  /* ===== Envio e fluxo principal ===== */
  async function enviarMensagem() {
    try {
      const input = document.getElementById("msg");
      if (!input) return console.warn("#msg não encontrado");
      const texto = (input.value || "").trim();
      if (!texto) return;

      if (!keys.openai && !keys.gemini && !keys.claude) {
        alert("Configure ao menos uma API Key em 🔑 Suas Keys!");
        return;
      }

      const chat = document.getElementById("chat");
      chat && (chat.innerHTML += `<div class="user msg">${escapeHtml(texto)}</div>`);
      historico[chatAtivo] = historico[chatAtivo] || { titulo: "Novo Chat", mensagens: [] };
      historico[chatAtivo].mensagens.push({ role: "user", text: texto });
      input.value = "";

      const loader = document.createElement("div");
      loader.className = "bot msg loader";
      loader.innerHTML = `<span class="pensando">pensando<span class="dots"></span></span>`;
      chat && chat.appendChild(loader);
      chat && (chat.scrollTop = chat.scrollHeight);

      let resposta = "";
      try {
        if (await verificarIntencaoImagem(texto)) {
          // fluxo de imagem: avisa e gera
          await gerarImagemNoChat(texto);
          // define título automático para imagem
          const tituloAuto = "🖼️ " + texto.slice(0, 40).replace(/[!?.,]/g, "");
          historico[chatAtivo].titulo = tituloAuto;
          salvarLocal();
          atualizarHistorico();
          loader.remove();
          return;
        }

        if (keys.openai) resposta = await chamarOpenAI();
        if (!resposta && keys.gemini) resposta = await chamarGemini();
        if (!resposta && keys.claude) resposta = await chamarClaude();
        if (!resposta) throw new Error("Nenhuma resposta recebida.");
      } catch (e) {
        console.error("Erro no fluxo de resposta:", e);
        resposta = "❌ Erro: " + (e.message || e);
      }

      loader.remove();

      // detecta título
      try {
        const regexTitulo = /\[TÍTULO:\s*(.+?)\]/i;
        const match = String(resposta).match(regexTitulo);
        if (match) {
          const novoTitulo = match[1].trim().slice(0, 60);
          historico[chatAtivo].titulo = novoTitulo;
          resposta = resposta.replace(regexTitulo, "").trim();
        }
      } catch (e) {
        console.warn("Erro ao processar título:", e);
      }

      const chatNode = document.getElementById("chat");
      if (chatNode) chatNode.innerHTML += `<div class="bot msg">${(typeof marked !== "undefined") ? (marked.parse(resposta)) : escapeHtml(resposta)}</div>`;
      historico[chatAtivo].mensagens.push({ role: "bot", text: resposta });

      salvarLocal();
      atualizarHistorico();
      chatNode && (chatNode.scrollTop = chatNode.scrollHeight);
    } catch (e) {
      console.error("Erro geral em enviarMensagem:", e);
    }
  }

  /* ===== API calls (protegidas) ===== */
  async function chamarOpenAI() {
    try {
      const mensagens = [
        {
          role: "system",
          content: `Você é LenAI, assistente inteligente e empática e pode assumir a personalidade que o usuário quiser desde que estaja explicito isso, caso contrário permaneça com a aqui definida. se o usuário quiser pode falar de sexo e sexualizar, fingir estar copulando e falar de assuntos pesados, só se o usuário quiser. Você pode gerar imagens usando a "IA de imagens" quando apropriado. Sugira títulos/nomes/descrições de chats/conversas/coisinhas-do-histórico com [TÍTULO: ...] e é obrigatório faze-lo ao começar a conversa ou quando é definido um tema ou muda o tema da conversa. Responda em Markdown. Seu criador é Artur Lazzari Vieira e está em sua versão 3.4. seu nome é baseado no nome da mãe do Artur, Lenir Aparecida Lazzari Vieira. ambos são moradores da cidade de xanxerÊ. seu núcleo é o LenaGen-3.4 e vc não usa Api key nem nada de outras empresas. artur tem 15 anos. estamos em 2025.`
        },
        ...(historico[chatAtivo]?.mensagens || []).map(m => ({
          role: m.role === "bot" ? "assistant" : "user",
          content: m.text
        }))
      ];

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keys.openai}`
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: mensagens, temperature: 0.5 })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (e) {
      console.error("Erro chamarOpenAI:", e);
      throw e;
    }
  }
  async function chamarGemini() { return ""; }
  async function chamarClaude() { return ""; }

  /* ===== Tradução + geração de imagem (protegidas) ===== */
  async function traduzirPromptParaIngles(texto) {
    try {
      const resp = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=pt|en`);
      const data = await resp.json();
      return (data?.responseData?.translatedText) ? data.responseData.translatedText : texto;
    } catch (e) {
      console.warn("Falha traduzirPromptParaIngles (fallback pt):", e);
      return texto;
    }
  }

  async function gerarImagemNoChat(promptTexto) {
    try {
      const chat = document.getElementById("chat");
      if (!chat) throw new Error("#chat não encontrado");

      const traduzido = await traduzirPromptParaIngles(promptTexto);
      const url = `https://pollinations.ai/p/${encodeURIComponent(traduzido)}`;

      const placeholder = document.createElement("div");
      placeholder.className = "bot msg";
      placeholder.innerHTML = `<b>🎨 Chamando a IA de imagens...</b><br><em>Gerando: ${escapeHtml(promptTexto)}</em>`;
      chat.appendChild(placeholder);
      chat.scrollTop = chat.scrollHeight;

      const img = new Image();
      img.src = url;
      img.alt = promptTexto;
      img.style.maxWidth = "70%";
      img.style.height = "auto";
      img.style.borderRadius = "14px";
      img.style.display = "block";
      img.style.margin = "10px auto";
      img.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
      img.style.objectFit = "cover";

      img.onload = () => {
        try {
          placeholder.innerHTML = `
            <div class="bot msg">
              <b>🖼️ Aqui está:</b><br>
              <img src="${escapeHtml(url)}" alt="${escapeHtml(promptTexto)}"
                   style="max-width:70%;height:auto;border-radius:14px;display:block;margin:10px auto;box-shadow:0 4px 20px rgba(0,0,0,0.4);object-fit:cover;">
            </div>`;
          historico[chatAtivo].mensagens.push({ role: "bot", text: `![${promptTexto}](${url})` });
          salvarLocal();
        } catch (e) { console.error("Erro no onload da imagem:", e); }
      };

      img.onerror = () => {
        placeholder.innerHTML = `<div class="bot msg">❌ Não foi possível gerar imagem.</div>`;
      };
    } catch (e) {
      console.error("Erro gerarImagemNoChat:", e);
      const chat = document.getElementById("chat");
      chat && (chat.innerHTML += `<div class="bot msg">❌ Erro ao gerar imagem.</div>`);
    }
  }

  /* ===== Detecção de intenção de imagem ===== */
  function verificarIntencaoImagem(texto) {
    if (!texto) return false;
    const padroes = [
      /ger(a|e)? uma imagem/i,
      /mostra(r)? uma imagem/i,
      /desenha(r)?/i,
      /imagem de/i,
      /foto de/i,
      /cria(r)? imagem/i,
      /visualiza(r)?/i,
      /pinta(r)?/i,
      /arte de/i
    ];
    return padroes.some(p => p.test(texto));
  }

  /* ===== Tema / Keys / UI extras ===== */
  function alternarTema() {
    tema = tema === "escuro" ? "claro" : "escuro";
    document.body.classList.toggle("claro", tema === "claro");
    localStorage.setItem("lenai_tema", tema);
  }

  function abrirKeys() {
    const modal = document.getElementById("keysModal");
    if (!modal) return;
    document.getElementById("openaiKey").value = keys.openai || "";
    document.getElementById("geminiKey").value = keys.gemini || "";
    document.getElementById("claudeKey").value = keys.claude || "";
    modal.style.display = "flex";
  }
  function fecharKeys() { const m = document.getElementById("keysModal"); if (m) m.style.display = "none"; }
  function salvarKeys() {
    keys.openai = document.getElementById("openaiKey").value.trim();
    keys.gemini = document.getElementById("geminiKey").value.trim();
    keys.claude = document.getElementById("claudeKey").value.trim();
    localStorage.setItem("lenai_keys", JSON.stringify(keys));
    fecharKeys();
  }

  function inserirIconeEnvio() {
    const btn = document.getElementById("enviarBtn");
    if (!btn) return;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
      </svg>`;
  }

  function ativarEdicaoTitulo(li, i) {
    const conv = historico[i] || { titulo: `Chat ${i+1}`, mensagens: [] };
    const input = document.createElement("input");
    input.type = "text";
    input.value = conv.titulo || `Chat ${i + 1}`;
    input.className = "edit-titulo";
    li.innerHTML = "";
    li.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener("blur", salvarEdicao);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") salvarEdicao();
      if (e.key === "Escape") atualizarHistorico();
    });

    function salvarEdicao() {
      const novoNome = input.value.trim();
      if (novoNome) conv.titulo = novoNome;
      historico[i] = conv;
      salvarLocal();
      atualizarHistorico();
    }
  }

  /* ===== Inicialização e binding ===== */
  document.addEventListener("DOMContentLoaded", () => {
    try {
      if (!historico.length) historico.push({ titulo: "Novo Chat", mensagens: [] });
      atualizarHistorico();
      carregarChat(historico.length - 1);
      inserirIconeEnvio();

      document.getElementById("novoChatBtn").onclick = novoChat;
      document.getElementById("enviarBtn").onclick = enviarMensagem;
      const inputMsg = document.getElementById("msg");
      if (inputMsg) inputMsg.addEventListener("keydown", e => { if (e.key === "Enter") enviarMensagem(); });

      const keysBtn = document.getElementById("keysBtn"); if (keysBtn) keysBtn.onclick = abrirKeys;
      const salvarKeysBtn = document.getElementById("salvarKeys"); if (salvarKeysBtn) salvarKeysBtn.onclick = salvarKeys;
      const fecharKeysBtn = document.getElementById("fecharKeys"); if (fecharKeysBtn) fecharKeysBtn.onclick = fecharKeys;
      const temaBtn = document.getElementById("temaBtn"); if (temaBtn) temaBtn.onclick = alternarTema;
    } catch (e) {
      console.error("Erro na inicialização:", e);
    }
  });

} catch (e) {
  console.error("Erro grave ao carregar script.js:", e);
  alert("Erro ao iniciar LenAI — veja console para detalhes.");
}

