// Valida os seis templates de e-mail do Supabase Auth desta pasta e gera preview.html.
// Uso (na raiz do repositório): node supabase/templates/build-preview.mjs
//
// Simula o que o Supabase Auth envia: troca as variáveis {{ .X }} por valores fictícios
// e mostra cada e-mail em duas larguras (desktop e celular). Nada é enviado, nenhum link funciona
// e nenhuma configuração do projeto Supabase é lida ou alterada.
//
// Antes de gerar a prévia, o script confere as regras do meio (e-mail) e do Supabase. Se alguma falhar,
// ele lista os problemas, NÃO grava preview.html e termina com código de saída 1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Valores de exemplo. O link dos botões aponta para o endpoint de Auth do projeto Supabase
// (https://<ref>.supabase.co/auth/v1/verify?...), não para o site, a menos que exista domínio próprio.
// SITE é um palpite para a prévia: a Site URL real fica em Authentication → URL Configuration.
const SITE = 'https://dispara-kappa.vercel.app';
const AUTH_HOST = 'https://mrpdknxvjqiymhkxivgi.supabase.co';
const SAMPLE_HASH = '7c1e5b0a94d2f38e6a1c4b7d90e2f5a8c3b6d9e1f4a7c0b3d6e9f2a5';

// Variáveis que o Supabase Auth oferece em cada template (docs "Email Templates" + mailer do
// supabase/auth). Usar outra imprime "<no value>" ou quebra o link no e-mail real.
// SendingTo existe no código do email_change, mas não é documentado: fica de fora de propósito.
// Data só vale com um campo ({{ .Data.campo }}, de auth.users.user_metadata): sozinho, imprime o mapa Go.
const LINK_VARS = ['ConfirmationURL', 'Token', 'TokenHash', 'SiteURL', 'RedirectTo', 'Data', 'Email'];
const ALLOWED = {
  confirmation: LINK_VARS,
  invite: LINK_VARS,
  magic_link: LINK_VARS,
  recovery: LINK_VARS,
  email_change: [...LINK_VARS, 'NewEmail'],
  reauthentication: ['Token', 'SiteURL', 'Email', 'Data'],
};

// Variáveis que cada template PRECISA ter para cumprir a função dele.
const REQUIRED = {
  confirmation: ['ConfirmationURL'],
  invite: ['ConfirmationURL'],
  magic_link: ['ConfirmationURL', 'Token'],
  recovery: ['ConfirmationURL'],
  email_change: ['ConfirmationURL', 'NewEmail'],
  reauthentication: ['Token'],
};

// Únicos destinos de link aceitos: a URL do Supabase e o mailto do próprio endereço.
const ALLOWED_HREFS = ['{{ .ConfirmationURL }}', 'mailto:{{ .Email }}', 'mailto:{{ .NewEmail }}'];

const TEMPLATES = [
  { key: 'confirmation', label: 'Confirmação de cadastro', panel: 'Confirm sign up', type: 'signup' },
  { key: 'invite', label: 'Convite', panel: 'Invite user', type: 'invite' },
  { key: 'magic_link', label: 'Link de acesso', panel: 'Magic link', type: 'magiclink' },
  { key: 'email_change', label: 'Alteração de e-mail', panel: 'Change email address', type: 'email_change' },
  { key: 'recovery', label: 'Redefinição de senha', panel: 'Reset password', type: 'recovery' },
  { key: 'reauthentication', label: 'Código de verificação', panel: 'Reauthentication', type: null },
];

const FONT = 'font-family:Manrope,Arial,Helvetica,sans-serif';
const MAX_WIDTH = 600;

// Padrões proibidos no HTML dos templates.
const FORBIDDEN = [
  [/<!--/, 'comentário HTML (o html/template do Go remove comentários, inclusive <!--[if mso]>)'],
  [/var\(\s*--/i, 'var(--…): clientes de e-mail não leem variáveis CSS; use hex literal'],
  [/display\s*:\s*(inline-)?(flex|grid)\b/i, 'display:flex/grid: use tabelas'],
  [/\b(grid-template[\w-]*|flex-(direction|wrap|flow|grow|shrink|basis))\s*:/i, 'propriedade de flex/grid'],
  [/backdrop-filter/i, 'backdrop-filter (vidro não existe em e-mail)'],
  [/<img\b/i, '<img> (sem imagens: nada remoto, nada para bloquear)'],
  [/<image\b/i, '<image> (o navegador converte em <img>)'],
  [/<link\b/i, '<link> (sem folhas ou fontes externas)'],
  [/<script\b/i, '<script>'],
  [/<base\b/i, '<base> (muda o destino de todos os links)'],
  [/http-equiv\s*=\s*["']?refresh/i, '<meta http-equiv="refresh"> (redireciona sem clique)'],
  [/http:\/\//i, 'URL http:// (só https, e de preferência nenhuma URL fixa)'],
  [/\b(href|src|action)\s*=\s*["']?\/\//i, 'URL relativa ao protocolo (//host)'],
  [/javascript\s*:/i, 'javascript: em link ou atributo'],
  [/[\s"'](on[a-z]+)\s*=/i, 'atributo de evento on* (onclick, onload…)'],
  [/[\s"'](background|src|srcset|poster|data|action|formaction)\s*=/i, 'atributo que carrega recurso remoto (background=, src=, srcset=…)'],
  [/<(form|input|button|select|textarea|iframe|frame|object|embed|applet|svg|math|video|audio|picture|source|track|canvas)\b/i, 'elemento interativo ou de mídia que clientes de e-mail removem'],
  [/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/i, 'cor em função (rgb(), hsl()…): use hex literal de 6 dígitos'],
  [/(^|[\s;"{])position\s*:/i, 'position (clientes de e-mail ignoram ou removem)'],
  [/@import|@font-face|url\s*\(/i, 'recurso externo (@import, @font-face ou url())'],
  [/expression\s*\(|-moz-binding|behavior\s*:/i, 'CSS executável (expression(), -moz-binding, behavior)'],
];

// Cores nomeadas do CSS (a regra do meio é hex literal de 6 dígitos).
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue '
  + 'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite '
  + 'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory '
  + 'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen '
  + 'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime '
  + 'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue '
  + 'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
  + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '
  + 'yellowgreen').split(' '));
const COLOR_PROPS = /(?<![\w-])(color|background-color|background|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|text-decoration(?:-color)?|-webkit-text-fill-color)\s*:\s*([^;"}]+)/gi;

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const lineOf = (html, index) => html.slice(0, index).split('\n').length;
const count = (text, token) => text.split(token).length - 1;

const subjectsPath = join(dir, 'subjects.json');
const subjects = existsSync(subjectsPath) ? JSON.parse(readFileSync(subjectsPath, 'utf8')) : {};

const SAMPLE_DATA = { first_name: 'Marina' };
const sampleValues = (t) => ({
  ConfirmationURL: t.type
    ? `${AUTH_HOST}/auth/v1/verify?token=${SAMPLE_HASH}&type=${t.type}&redirect_to=${encodeURIComponent(SITE)}`
    : '',
  Token: '482913',
  TokenHash: SAMPLE_HASH,
  SiteURL: SITE,
  RedirectTo: SITE,
  Email: 'marina.costa@exemplo.com.br',
  NewEmail: 'marina.costa@novoendereco.com.br',
});

// O Supabase passa assunto e corpo pelo html/template do Go. Se o parse falhar, o Auth usa o
// template PADRÃO (em inglês) e só registra o erro no log: por isso qualquer {{ ou }} solto é erro aqui.
function checkActions(text, t, fail) {
  const used = new Set();
  if (count(text, '{{') !== count(text, '}}')) fail(`"{{" (${count(text, '{{')}) e "}}" (${count(text, '}}')}) em quantidades diferentes: ação de template aberta ou solta`);
  for (const m of text.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    const exact = /^\{\{ \.([A-Za-z]+)(?:\.([A-Za-z_][A-Za-z0-9_]*))? \}\}$/.exec(m[0]);
    if (!exact) { fail(`ação de template fora do formato "{{ .Nome }}": ${m[0]}`, m.index); continue; }
    const [, name, field] = exact;
    if (field && name !== 'Data') { fail(`{{ .${name}.${field} }}: só Data aceita subcampo`, m.index); continue; }
    if (name === 'Data' && !field) { fail('{{ .Data }} sozinho imprime o mapa Go (map[...]); use {{ .Data.campo }}', m.index); continue; }
    if (!ALLOWED[t.key].includes(name)) { fail(`{{ .${name} }} não existe no template "${t.panel}" do Supabase`, m.index); continue; }
    used.add(name);
  }
  return used;
}

function render(t, text) {
  const values = sampleValues(t);
  // O html/template do Go remove comentários e escapa os valores; aqui o efeito visual é o mesmo.
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{ \.([A-Za-z]+)(?:\.([A-Za-z_][A-Za-z0-9_]*))? \}\}/g, (m, name, field) => {
      if (name === 'Data' && field) return escapeHtml(SAMPLE_DATA[field] ?? 'Marina');
      return name in values ? escapeHtml(values[name]) : m;
    });
}

function check(t) {
  const errors = [];
  const file = `${t.key}.html`;
  const path = join(dir, file);
  if (!existsSync(path)) return { errors: [`${file}: arquivo não encontrado`] };
  const html = readFileSync(path, 'utf8');
  const fail = (msg, index) => errors.push(`${file}${index === undefined ? '' : `:${lineOf(html, index)}`}: ${msg}`);

  for (const [re, msg] of FORBIDDEN) {
    const m = re.exec(html);
    if (m) fail(msg, m.index);
  }

  // Links: só os destinos de ALLOWED_HREFS, sempre entre aspas duplas.
  for (const m of html.matchAll(/\shref\s*=\s*("([^"]*)"|'[^']*'|[^\s>]+)/gi)) {
    if (m[2] === undefined) fail(`href sem aspas duplas: ${m[1]}`, m.index);
    else if (!ALLOWED_HREFS.includes(m[2])) fail(`href="${m[2]}" fora da lista (${ALLOWED_HREFS.join(', ')})`, m.index);
  }

  // Cores: só hex de 6 dígitos (nada de #fff, #rrggbbaa nem cores nomeadas). Ignora entidades como &#847;.
  for (const m of html.matchAll(/(?<!&)#([0-9a-f]+)\b/gi)) {
    if (m[1].length !== 6) fail(`cor ${m[0]}: use hex de 6 dígitos`, m.index);
  }
  for (const m of html.matchAll(/\s(bgcolor|color)\s*=\s*"([^"]*)"/gi)) {
    if (!/^#[0-9a-f]{6}$/i.test(m[2])) fail(`${m[1]}="${m[2]}": use hex de 6 dígitos`, m.index);
  }
  for (const m of html.matchAll(COLOR_PROPS)) {
    const named = m[2].toLowerCase().split(/[\s,()]+/).find((tok) => NAMED_COLORS.has(tok));
    if (named) fail(`${m[1]}: cor nomeada "${named}"; use hex de 6 dígitos`, m.index);
  }

  // Fonte repetida em toda célula, parágrafo, título, item e link (o Outlook não herda do body),
  // e em todo <div> com texto visível (os <div> ocultos do pré-cabeçalho ficam de fora).
  for (const m of html.matchAll(/<(td|th|p|h[1-6]|a|li)\b[^>]*>/gi)) {
    if (!m[0].includes(FONT)) fail(`<${m[1]}> sem "${FONT}"`, m.index);
  }
  for (const m of html.matchAll(/<div\b([^>]*)>([^<]*)/gi)) {
    if (m[2].trim() && !/display\s*:\s*none/i.test(m[1]) && !m[1].includes(FONT)) fail(`<div> com texto sem "${FONT}"`, m.index);
  }

  // Largura máxima de 600 px: atributo width (usado pelo Outlook) e width/min-width/max-width em CSS.
  for (const m of html.matchAll(/\bwidth="(\d+)"/gi)) {
    if (Number(m[1]) > MAX_WIDTH) fail(`width="${m[1]}" passa de ${MAX_WIDTH} px`, m.index);
  }
  const cssOnly = html.replace(/@media[^{]*/gi, (s) => ' '.repeat(s.length)); // condições de @media não são larguras de layout
  for (const m of cssOnly.matchAll(/(?<![\w-])((?:max-|min-)?width)\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
    if (Number(m[2]) > MAX_WIDTH) fail(`${m[1]}:${m[2]}px passa de ${MAX_WIDTH} px`, m.index);
  }
  if (!/class="dp-container"[^>]*style="[^"]*max-width:100%/.test(html)) fail('contêiner sem max-width:100% (não encolhe até 320 px)');

  // Cabeçalho do e-mail.
  if (!/<html lang="pt-BR">/.test(html)) fail('<html lang="pt-BR"> ausente');
  if (!/<meta name="color-scheme" content="light only">/.test(html)) fail('meta color-scheme "light only" ausente');
  if (!/<meta name="supported-color-schemes" content="light only">/.test(html)) fail('meta supported-color-schemes "light only" ausente');
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (!title) fail('<title> ausente');
  else if (subjects[t.key] !== title) fail(`<title> "${title}" difere do assunto em subjects.json ("${subjects[t.key] ?? 'ausente'}")`);
  const preheader = (html.match(/<div style="display:none;[^"]*">([^<]+)<\/div>/) || [])[1] || '';
  if (!preheader.trim()) fail('pré-cabeçalho oculto ausente (primeiro <div style="display:none;…">)');

  // Variáveis do Supabase: formato exato e só as que existem neste template.
  const used = checkActions(html, t, fail);
  for (const name of REQUIRED[t.key]) {
    if (!used.has(name)) fail(`falta {{ .${name} }}, necessária neste template`);
  }

  // Assunto: também é template Go no Supabase.
  if (typeof subjects[t.key] === 'string') {
    const subjectErrors = [];
    checkActions(subjects[t.key], t, (msg) => subjectErrors.push(msg));
    if (/\{\{|\}\}/.test(render(t, subjects[t.key]))) subjectErrors.push('sobrou "{{" ou "}}" depois da substituição');
    for (const msg of subjectErrors) errors.push(`subjects.json (${t.key}): ${msg}`);
  }

  // Depois da substituição não pode sobrar nenhuma ação: no Supabase, isso derrubaria o template inteiro.
  const rendered = render(t, html);
  const left = /\{\{|\}\}/.exec(rendered);
  if (left) fail(`sobrou "${left[0]}" depois da substituição: ação de template aberta, truncada ou solta`);

  return { errors, html, rendered, preheader, used: [...used] };
}

// config-snippet.toml: mesmas chaves, mesmos assuntos de subjects.json e content_path de cada arquivo.
function checkSnippet() {
  const errors = [];
  const path = join(dir, 'config-snippet.toml');
  if (!existsSync(path)) return ['config-snippet.toml: arquivo não encontrado'];
  const blocks = {};
  let cur = null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const head = /^\s*\[auth\.email\.template\.([a-z_]+)\]\s*$/.exec(line);
    if (head) { cur = head[1]; blocks[cur] = {}; continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    const kv = /^\s*(subject|content_path)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (cur && kv) blocks[cur][kv[1]] = JSON.parse(`"${kv[2]}"`);
  }
  const expected = TEMPLATES.map((t) => t.key).sort().join(',');
  const found = Object.keys(blocks).sort().join(',');
  if (found !== expected) errors.push(`config-snippet.toml: blocos esperados ${expected}, encontrados ${found}`);
  for (const t of TEMPLATES) {
    const b = blocks[t.key];
    if (!b) continue;
    if (b.subject !== subjects[t.key]) errors.push(`config-snippet.toml (${t.key}): subject "${b.subject ?? 'ausente'}" difere de subjects.json ("${subjects[t.key] ?? 'ausente'}")`);
    const want = `./supabase/templates/${t.key}.html`;
    if (b.content_path !== want) errors.push(`config-snippet.toml (${t.key}): content_path "${b.content_path ?? 'ausente'}", esperado "${want}"`);
  }
  return errors;
}

const results = TEMPLATES.map((t) => ({ ...t, ...check(t) }));
const expectedKeys = TEMPLATES.map((t) => t.key).sort().join(',');
const subjectKeys = Object.keys(subjects).sort().join(',');
const globalErrors = [];
if (!existsSync(subjectsPath)) globalErrors.push('subjects.json: arquivo não encontrado');
else if (subjectKeys !== expectedKeys) globalErrors.push(`subjects.json: chaves esperadas ${expectedKeys}, encontradas ${subjectKeys}`);
globalErrors.push(...checkSnippet());

const allErrors = [...globalErrors, ...results.flatMap((r) => r.errors)];
if (allErrors.length) {
  console.error(`Falhou: ${allErrors.length} problema(s). preview.html não foi gerado.\n`);
  for (const e of allErrors) console.error(`  - ${e}`);
  process.exit(1);
}

const frames = [
  { id: 'desktop', label: 'Desktop', width: 640 },
  { id: 'mobile', label: 'Celular', width: 320 },
];

const cards = results.map((t) => {
  const srcdoc = escapeHtml(t.rendered);
  const vars = t.used.map((v) => `<code>{{ .${escapeHtml(v)} }}</code>`).join(' ');
  const views = frames.map((f) => `
            <figure class="view view-${f.id}">
              <figcaption>${f.label} &middot; ${f.width} px</figcaption>
              <div class="frame" style="width:${f.width}px">
                <iframe title="${escapeHtml(`${t.label}, ${f.label.toLowerCase()} ${f.width} px`)}" srcdoc="${srcdoc}" width="${f.width}" height="900"></iframe>
              </div>
            </figure>`).join('');
  return `
      <article class="card" id="${t.key}">
        <header class="card-head">
          <div class="card-title">
            <h2>${escapeHtml(t.label)}</h2>
            <code>${t.key}.html</code>
          </div>
          <dl class="meta">
            <div><dt>Assunto</dt><dd>${escapeHtml(subjects[t.key])}</dd></div>
            <div><dt>Pré-cabeçalho</dt><dd>${escapeHtml(t.preheader)}</dd></div>
            <div><dt>No painel</dt><dd>${escapeHtml(t.panel)}</dd></div>
            <div><dt>Variáveis</dt><dd>${vars}</dd></div>
          </dl>
        </header>
        <div class="views">${views}
        </div>
      </article>`;
}).join('\n');

const nav = results.map((t) => `<a href="#${t.key}">${escapeHtml(t.label)}</a>`).join('');

const page = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>E-mails do Dispara</title>
  <meta name="description" content="Prévia dos seis templates de e-mail do Supabase Auth do Dispara, com valores fictícios.">
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7f5; --surface: #ffffff; --raised: #eaf0ec; --text: #10251a; --muted: #405d4c;
      --subtle: #546f5f; --border: #d5dfd8; --accent: #0fa968; --accent-text: #08643e; --focus: #07683f;
      --font: 'Manrope', Arial, Helvetica, sans-serif;
      --mono: 'SFMono-Regular', Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        color-scheme: dark;
        --bg: #080a09; --surface: #111613; --raised: #1b221e; --text: #f6f7f6; --muted: #b4bdb7;
        --subtle: #929f96; --border: #2a342e; --accent-text: #8de7bb; --focus: #91f2c3;
      }
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #080a09; --surface: #111613; --raised: #1b221e; --text: #f6f7f6; --muted: #b4bdb7;
      --subtle: #929f96; --border: #2a342e; --accent-text: #8de7bb; --focus: #91f2c3;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.65; }
    main { max-width: 1240px; margin: 0 auto; padding: 32px 16px 56px; }
    h1 { margin: 0; font-size: clamp(1.5rem, 2.2vw, 2rem); line-height: 1.12; letter-spacing: -0.03em; font-weight: 650; }
    h1 i { font-style: normal; color: var(--accent); }
    .lead { margin: 8px 0 0; color: var(--muted); max-width: 72ch; font-size: 0.95rem; }
    code { font-family: var(--mono); font-size: 0.85em; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 28px; }
    nav a { color: var(--accent-text); text-decoration: none; font-size: 0.875rem; font-weight: 600;
      padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); }
    nav a:hover { background: var(--raised); }
    nav a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .stack { display: grid; gap: 24px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 23px; overflow: hidden; min-width: 0; scroll-margin-top: 16px; }
    .card-head { padding: 18px 20px 16px; border-bottom: 1px solid var(--border); }
    .card-title { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
    h2 { margin: 0; font-size: 1.1rem; letter-spacing: -0.01em; font-weight: 650; }
    .card-title code { color: var(--subtle); }
    .meta { margin: 12px 0 0; display: grid; gap: 4px; font-size: 0.85rem; }
    .meta div { display: grid; grid-template-columns: 8rem 1fr; gap: 8px; }
    .meta dt { color: var(--subtle); }
    .meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .meta dd code { color: var(--accent-text); margin-right: 6px; }
    .views { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; padding: 20px; background: var(--raised); overflow-x: auto; }
    .view { margin: 0; flex: none; }
    .view figcaption { font-size: 0.75rem; font-weight: 650; letter-spacing: 0.075em; text-transform: uppercase; color: var(--subtle); margin-bottom: 8px; }
    .frame { border-radius: 13px; overflow: hidden; border: 1px solid var(--border); background: #f4f7f5; }
    iframe { display: block; border: 0; background: #f4f7f5; }
    footer.note { margin-top: 28px; color: var(--subtle); font-size: 0.85rem; max-width: 80ch; }
    @media (max-width: 720px) {
      .views { padding: 12px; }
      .meta div { grid-template-columns: 1fr; gap: 0; }
      .meta div + div { margin-top: 6px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>E-mails do Dispara<i>.</i></h1>
    <p class="lead">Prévia dos seis templates do Supabase Auth com valores fictícios: <code>marina.costa@exemplo.com.br</code>, código <code>482913</code> e links de exemplo que não funcionam. Os links usam o domínio do projeto Supabase (<code>…supabase.co</code>), como no e-mail real. Cada e-mail aparece a 640 px e a 320 px, a menor largura suportada.</p>
    <nav aria-label="Templates">${nav}</nav>
    <section class="stack" aria-label="Templates">
${cards}
    </section>
    <footer class="note">Gerado por <code>build-preview.mjs</code> a partir dos arquivos HTML desta pasta, depois das verificações de variáveis e de compatibilidade. Os e-mails usam tema claro fixo (<code>color-scheme: light only</code>); a moldura desta página acompanha o tema do sistema. A prévia no navegador não certifica a renderização no Gmail, no Outlook nem no Apple Mail.</footer>
  </main>
  <script>
    (function () {
      function fit(frame) {
        try {
          var doc = frame.contentDocument;
          if (!doc || !doc.documentElement) return;
          frame.style.height = '60px';
          frame.style.height = Math.ceil(doc.documentElement.scrollHeight) + 'px';
        } catch (e) { frame.style.height = '900px'; }
      }
      var frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
      frames.forEach(function (f) {
        f.addEventListener('load', function () { fit(f); });
        if (f.contentDocument && f.contentDocument.readyState === 'complete') fit(f);
      });
      window.addEventListener('resize', function () { frames.forEach(fit); });
    })();
  </script>
</body>
</html>
`;

writeFileSync(join(dir, 'preview.html'), page, 'utf8');
console.log(`OK: ${results.length} templates validados. preview.html gerado em ${join(dir, 'preview.html')}`);
