# Templates de e-mail do Dispara (Supabase Auth)

Seis e-mails de autenticação em pt-BR, montados sobre o esqueleto de e-mail do design system **Empreende.IA V2** (mesma anatomia dos modelos `welcome` e `billing` do DS). Eles não carregam imagens, fontes remotas, rastreadores, JavaScript nem formulários.

## Antes de tudo: o Dispara não usa Supabase Auth

O login do Dispara é uma senha mestra única (`MASTER_PASSWORD`), validada pelo `proxy.ts` com o cookie `dispara_session`. Nenhum código do repositório chama `supabase.auth.*` e, em 12/10/2026, a tabela `auth.users` do projeto estava vazia. **O app não envia nenhum destes e-mails.**

Mesmo assim, eles podem sair em três casos:

- alguém usa o painel do Supabase, em **Authentication → Users** (*Invite user*, *Send magic link*, *Send password recovery*);
- alguém chama direto a API pública de Auth do projeto (`/auth/v1/signup`, `/auth/v1/otp`, `/auth/v1/recover`) com a publishable key. Essa chave vai para o navegador (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, usada no Realtime), e o Supabase deixa o cadastro por e-mail e o magic link ligados por padrão, criando o usuário se ele não existir. Enquanto o cadastro estiver aberto, qualquer pessoa consegue fazer o projeto enviar o `confirmation` e o `magic_link` para qualquer endereço. Depois de criar a própria conta, também consegue disparar o `email_change` e o `reauthentication`;
- o Dispara passa a usar Supabase Auth no futuro.

A configuração de Auth do projeto hospedado (cadastro aberto ou fechado, CAPTCHA, SMTP, Site URL) **não foi conferida** nesta entrega. Veja "Antes de usar com pessoas reais".

Os links confirmam a ação no Supabase Auth (`https://<ref>.supabase.co/auth/v1/verify?...`) e depois abrem a Site URL do projeto, com a sessão do Supabase no fragmento da URL. **Eles não fazem login no Dispara**: o `proxy.ts` só aceita o cookie `dispara_session`, então a pessoa cai na tela da senha mestra. Por isso os e-mails descrevem só o que o link faz no Supabase ("confirmar o pedido", "aceitar o convite", "continuar a redefinição") e não prometem acesso nem telas que o app não tem:

- o `magic_link.html` não diz que o link dá acesso ao Dispara, e o código `{{ .Token }}` aparece como alternativa ao link para o mesmo pedido, sem citar nenhuma tela do Dispara e com o aviso de não compartilhar;
- o `recovery.html` não promete trocar senha: o Dispara não tem tela para definir uma senha nova, e a senha mestra nunca é alterada por estes e-mails. Hoje, *Send password recovery* termina na tela de login da senha mestra. **Não use essa ação com pessoas reais por enquanto.**

## Arquivos

| Arquivo | Template no painel | Assunto |
|---|---|---|
| `confirmation.html` | Confirm sign up | Confirme seu e-mail no Dispara |
| `invite.html` | Invite user | Convite para o Dispara |
| `magic_link.html` | Magic link | Seu link de acesso ao Dispara |
| `email_change.html` | Change email address | Confirme a alteração de e-mail no Dispara |
| `recovery.html` | Reset password | Pedido de redefinição de senha no Dispara |
| `reauthentication.html` | Reauthentication | Código de verificação do Dispara |

Também nesta pasta:

- `subjects.json`: os mesmos assuntos, por template.
- `config-snippet.toml`: blocos no formato do Supabase CLI, para uso local.
- `build-preview.mjs`: valida os templates, os assuntos e o `config-snippet.toml` e gera `preview.html`.
- `.gitignore`: ignora o `preview.html` gerado.

## Aplicar no painel (projeto hospedado)

1. Acesse **Authentication → URL Configuration** no projeto `dispara` (ref `mrpdknxvjqiymhkxivgi`) e confira se a **Site URL** é a URL de produção do Dispara. Em projeto novo, o padrão é `http://localhost:3000`, e aí o botão de todos os e-mails termina numa página que não abre. A prévia usa `https://dispara-kappa.vercel.app` só como exemplo; esse valor não foi conferido no projeto.
2. Acesse **Authentication → Emails → Templates**. Para cada linha da tabela, abra o template, cole o **assunto** e substitua todo o corpo pelo conteúdo do `.html` correspondente. Salve.
3. Para testar, comece por **Authentication → Users → Invite user**, com um endereço da equipe do projeto (veja "SMTP padrão" abaixo). O convite **cria um usuário real em `auth.users`**, e esse usuário consegue obter sessão no Supabase Auth. *Send magic link* e *Send password recovery* só funcionam para um usuário que já existe, então só dá para testá-los depois do convite. Ao terminar, apague o usuário de teste em **Authentication → Users**. Enquanto ele existir, a frase "a tabela `auth.users` estava vazia" acima deixa de valer.

Mantenha as variáveis exatamente como estão, com um espaço de cada lado: `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` e `{{ .NewEmail }}`. Isso inclui as que estão dentro de `href="mailto:..."`. O Supabase processa assunto e corpo com o `html/template` do Go. Se o parse falhar (por exemplo, por um `{{` solto), ele usa o template **padrão em inglês** e só registra o erro no log, sem avisar no painel. Por isso, rode o gerador antes de colar qualquer alteração.

## Prévia e verificações

Na raiz do repositório:

```bash
node supabase/templates/build-preview.mjs
```

O script não tem dependências. Ele confere os seis arquivos, o `subjects.json` e o `config-snippet.toml`. Se tudo passar, gera `supabase/templates/preview.html`, com cada e-mail a 640 px e a 320 px e valores fictícios. Se algo falhar, ele lista os problemas com arquivo e linha, não grava a prévia e termina com código 1. Ele falha quando:

- um template ou assunto usa uma variável que o Supabase não oferece naquele tipo de e-mail (por exemplo, `{{ .ConfirmationURL }}` no `reauthentication.html`), escreve uma variável fora do formato `{{ .Nome }}` ou usa `{{ .Data }}` sem campo (imprimiria o mapa inteiro; use `{{ .Data.campo }}`);
- o número de `{{` e de `}}` não bate, ou sobra `{{`/`}}` depois da substituição (ação truncada ou solta, no corpo ou no assunto);
- falta a variável essencial do tipo (o link nos cinco templates com botão, o código no `reauthentication.html` e no `magic_link.html`, o `{{ .NewEmail }}` no `email_change.html`);
- um link aponta para outro lugar que não `{{ .ConfirmationURL }}`, `mailto:{{ .Email }}` ou `mailto:{{ .NewEmail }}`;
- há comentário HTML, `var(--…)`, `display:flex` ou `grid`, `backdrop-filter`, `position`, `<img>`, `<image>`, `<link>`, `<script>`, `<base>`, `<meta http-equiv="refresh">`, formulário ou mídia, `@import`, `@font-face`, `url()`, `javascript:`, atributo `on…=`, atributo `background=`/`src=`/`srcset=`/`poster=`, URL `http://` ou `//host`;
- há cor fora do hex de 6 dígitos: `#fff`, `#rrggbbaa`, `rgb()`/`hsl()` ou cor nomeada (`white`, `green`…), inclusive em `bgcolor`;
- um `<td>`, `<th>`, `<p>`, `<h1>`…`<h6>`, `<a>`, `<li>` ou `<div>` com texto visível não tem `font-family:Manrope,Arial,Helvetica,sans-serif`;
- algo passa de 600 px de largura (atributo `width` ou `width`/`min-width`/`max-width` em CSS), o contêiner perde o `max-width:100%`, falta o `lang="pt-BR"`, as metas `light only` ou o pré-cabeçalho, ou o `<title>` difere do assunto em `subjects.json`;
- o `config-snippet.toml` não tem os mesmos seis blocos, os mesmos assuntos do `subjects.json` ou o `content_path` `./supabase/templates/<tipo>.html`.

A prévia no navegador não certifica a renderização no Gmail, no Outlook nem no Apple Mail. Antes de usar com clientes, envie um teste real para essas caixas.

## Variáveis por template

| Template | Usa | O Supabase oferece |
|---|---|---|
| `confirmation`, `invite`, `recovery` | `ConfirmationURL`, `Email` | `ConfirmationURL`, `Token`, `TokenHash`, `SiteURL`, `RedirectTo`, `Data`, `Email` |
| `magic_link` | `ConfirmationURL`, `Email`, `Token` | os mesmos |
| `email_change` | `ConfirmationURL`, `Email`, `NewEmail` | os mesmos + `NewEmail` |
| `reauthentication` | `Token` | `Token`, `SiteURL`, `Email`, `Data` (sem link) |

As listas seguem a documentação "Email Templates" do Supabase e o mailer do `supabase/auth`. O código do `email_change` também passa `SendingTo`, mas ele não é documentado e o gerador o recusa. `Data` traz o `user_metadata` do usuário e só é aceito com um campo, como `{{ .Data.first_name }}`.

## Design system

A anatomia é a dos modelos de e-mail do DS (`references/formatos.md`, seção E-mail): nome do produto → faixa escura com eyebrow e título → cartão branco com texto, linhas rótulo/valor, **um** botão e nota → rodapé. Tabelas `role="presentation"`, estilos inline, hex literal, fundo claro fixo, largura máxima de 600 px que encolhe até 320 px. O botão tem a largura do texto também no celular, como no `welcome.html` do DS (48 px de altura de toque).

| Hex | Origem no DS (tema claro) | Uso |
|---|---|---|
| `#f4f7f5` | `--eia-color-bg` | fundo do e-mail |
| `#ffffff` | `--eia-color-surface` / `--eia-color-on-accent` | cartão; texto da faixa e do botão |
| `#10251a` | `--eia-color-text` | texto principal; cor da faixa escura |
| `#254b37` | literal dos modelos de e-mail do DS (igual a `--eia-color-code-text`) | fim do degradê da faixa |
| `#466b55` | literal dos modelos de e-mail do DS | borda da faixa escura |
| `#c9ebd7` | `--eia-color-selection` | eyebrow sobre a faixa |
| `#405d4c` | `--eia-color-text-muted` | corpo do texto e rótulos |
| `#546f5f` | `--eia-color-text-subtle` | textos auxiliares e rodapé |
| `#d5dfd8` | literal dos modelos de e-mail do DS | bordas e divisórias |
| `#08643e` | `--eia-color-accent-text` | botão sólido (como nos modelos do DS) e link "copie e cole" |
| `#075534` | literal dos modelos de e-mail do DS | borda do botão |
| `#eaf0ec` | `--eia-color-surface-raised` | caixa do código |
| `#0fa968` | `--eia-color-accent` | só o ponto final do título, a assinatura tipográfica do DS |

O primário do DS é o degradê `#13794f → #0b6140` (`--eia-material-primary`). Em e-mail, ele vira o botão sólido `#08643e` dos modelos oficiais. A faixa escura usa `background-color:#10251a` e o degradê `#10251a → #254b37`; onde o degradê não é suportado, ela fica sólida.

Diferenças em relação aos modelos do DS, todas de propósito:

- **Sem logo.** O DS pede o PNG `eia-email-2x.png` numa URL HTTPS absoluta, e não há esse arquivo hospedado. O wordmark da Empreende.IA não é recriado com texto. No topo aparece só o nome do produto, "Dispara", em texto simples, e o rodapé traz o crédito "Dispara · Empreende.IA". Para usar o logo, hospede o PNG, insira a linha de logo descrita em `formatos.md` e libere `<img>` no `build-preview.mjs`.
- **Sem versão `.txt`.** O painel do Supabase só aceita o corpo HTML.
- **Dois blocos `<style>`**, contrariando o "100% inline" de `formatos.md`. O primeiro tem só o reset do `body` e a media query, que reduz margens, título e código e, abaixo de 620 px, empilha rótulo e valor nas linhas da tabela, para os endereços de e-mail usarem a largura toda do cartão. O segundo tem `:root { color-scheme; supported-color-schemes }` (esta última propriedade não é padrão), o reset `mso-table-*` e o seletor de atributo `a[x-apple-data-detectors]`. Eles ficam separados para que um cliente que descarte um bloco inteiro por não entender um seletor ou uma propriedade não leve junto as regras de celular. **Não junte os dois blocos.** Tudo o que é essencial está inline. Sem nenhum `<style>`, o layout continua cabendo em 320 px; nesse caso, rótulo e valor ficam lado a lado e endereços longos quebram dentro da coluna (conferido no navegador com os blocos removidos).
- **Sem "Gerenciar preferências".** E-mails de autenticação não são marketing.

Escolhas de texto e quebra de linha:

- **Grafia "e-mail"**, como no guia de voz do DS e no VOLP. Cada "e-mail" visível fica num `<span style="white-space:nowrap;">`, para o navegador não quebrar a linha no hífen ("e-" numa linha, "mail" na outra). Assunto, `<title>` e pré-cabeçalho usam texto puro.
- **Endereços** usam `overflow-wrap:anywhere` e só quebram quando não cabem na largura. O endereço "copie e cole" mantém `word-break:break-all`: sem ele, o Edge quebrou a URL nos `/` e `?` e deixou um `?` sozinho numa linha a 360 px.
- **Pré-cabeçalho** diz a validade e o que fazer se a pessoa não pediu. O corpo abre com o fato ou a instrução, sem repetir o pré-cabeçalho (regra do DS).

## Ambiente local (config.toml)

O repositório não tem `supabase/config.toml`. Os blocos de `config-snippet.toml` ficam separados de propósito. Para usá-los num Supabase local, cole-os no `config.toml` local e rode `supabase stop && supabase start`.

**Não use `supabase config push` no projeto hospedado** até espelhar no `config.toml` toda a configuração de Auth do painel: `site_url`, `additional_redirect_urls`, `enable_signup`, `[auth.email] enable_confirmations`, `double_confirm_changes`, `secure_password_change`, `otp_expiry`, `otp_length`, `max_frequency` e SMTP. O push compara a seção `[auth]` inteira com os padrões do CLI. Sem esses valores, ele pode desligar a confirmação de e-mail, reabrir o cadastro público ou trocar a Site URL pelo endereço local. Revise o diff que o CLI mostra antes de confirmar. No projeto hospedado, prefira o painel.

## Antes de usar com pessoas reais

- **Feche o cadastro público antes de tudo:** como o Dispara não usa Supabase Auth, desligue **Allow new users to sign up** em **Authentication → Sign In / Providers** (ou desative o provedor Email, se o painel não precisar dele). Se quiser manter o cadastro, ative **Enable CAPTCHA protection** na página de proteção contra bots e abuso do Auth (`/dashboard/project/mrpdknxvjqiymhkxivgi/auth/protection`); o Supabase passa a exigir o CAPTCHA no cadastro, no login e na redefinição de senha. O convite pelo painel usa a API admin e deve continuar funcionando com o cadastro fechado; confirme isso no primeiro teste. Faça este passo **antes** do SMTP próprio: com o SMTP padrão, os e-mails só chegam à equipe do projeto; com SMTP próprio, qualquer chamada à API pública passa a enviar e-mails do Dispara, do seu domínio, para qualquer endereço. A documentação "Send emails with custom SMTP" do Supabase descreve esse abuso (bots cadastrando listas de e-mails para queimar a reputação de envio).
- **Nome da marca:** em produção, `settings.brand_name` está como "Henrique Gabriel". Os templates usam o nome do produto, "Dispara" (o padrão de `lib/branding.ts`), porque o Supabase não lê a tabela `settings` do app. Se preferir a marca configurada, troque "Dispara" no `subjects.json`, no `config-snippet.toml` e nos seis `.html` (`<title>`, nome no topo, textos e rodapé) e rode o gerador de novo.
- **SMTP padrão:** a configuração de SMTP do projeto não foi conferida nesta entrega. Se ele ainda usa o envio padrão do Supabase, o remetente aparece como "Supabase Auth", o envio só chega a endereços da equipe do projeto e há um limite baixo de mensagens por hora, que o Supabase pode mudar sem aviso. Para enviar a outras pessoas (depois de fechar o cadastro, item acima), configure um SMTP em **Authentication → Emails → SMTP Settings**, com remetente `Dispara <...@seu-dominio>` e SPF, DKIM e DMARC no domínio. Desligue o rastreamento de cliques no provedor, porque ele reescreve os links.
- **Domínio dos links:** o botão e o endereço "copie e cole" usam o domínio do projeto Supabase (`https://mrpdknxvjqiymhkxivgi.supabase.co/auth/v1/verify?...`), não o domínio do app na Vercel. Uma marca "Dispara" com link para um subdomínio aleatório lembra phishing. Para mostrar um domínio próprio, configure um domínio personalizado no Supabase.
- **Validade:** o texto diz "validade limitada" porque o valor de **Email OTP Expiration** (`otp_expiry`) não foi conferido. O padrão do Supabase é 3600 s (1 hora). Se confirmar o valor no painel, você pode trocar o texto por "expira em 1 hora".
- **Tamanho do código:** a caixa do código (`magic_link.html` e `reauthentication.html`) foi dimensionada para 6 dígitos, o padrão de **Email OTP Length**, e cabe em 320 px. Se o tamanho mudar, confira a prévia a 320 px.
- **Scanners de link:** filtros corporativos podem abrir o link antes da pessoa e consumi-lo, gerando o erro "Token has expired or is invalid". O `magic_link.html` mostra o código `{{ .Token }}`, que confirma o mesmo pedido, mas o Dispara não tem tela para digitá-lo (exigiria `verifyOtp`). O texto do e-mail não cita nenhuma tela e pede para não compartilhar o código, nem por WhatsApp ou telefone.
- **Alteração de e-mail:** com **Secure email change** ligado (padrão do Supabase), o endereço atual e o novo recebem um link cada e os dois precisam ser usados. Como essa opção não foi conferida, o `email_change.html` diz só o que vale nos dois casos: se o outro endereço também recebeu um e-mail como este, a alteração só termina depois dos dois links. Quando um usuário anônimo vincula um e-mail, `{{ .Email }}` vem vazio e a linha "E-mail atual" aparece em branco. O Dispara não usa login anônimo, então isso não acontece hoje. Se passar a usar, trate a linha com `{{ if .Email }}…{{ end }}` e libere `if`/`end` no `build-preview.mjs`.
- **Notificações de segurança:** o Supabase também tem e-mails de notificação (*Password changed*, *Email address changed*, *Phone number changed*, *Sign-in method linked/removed*, *Verification method added/removed*), que só saem se forem ligados no projeto. Eles **não** foram traduzidos nesta entrega. Se forem ligados, saem com o texto padrão em inglês.
- **Outlook para Windows:** o Supabase processa os templates com o `html/template` do Go, que remove comentários HTML. Por isso não há comentários condicionais `<!--[if mso]>` nem VML. O Outlook usa a largura fixa de 600 px (atributo `width`), ignora cantos arredondados e o degradê (a faixa fica `#10251a` sólida), e só o texto do botão é clicável. Nos outros clientes, a área inteira do botão é clicável.
- **Modo escuro:** as metas pedem tema claro (`light only`), mas alguns apps, como o Gmail e o Outlook no celular, ainda podem inverter cores por conta própria.
- **Endereços de e-mail no corpo:** os endereços aparecem dentro de um link `mailto:` com estilo próprio, para o Gmail não transformá-los em links azuis sublinhados. O `html/template` escapa os valores. O Supabase recomenda evitar dados do usuário em e-mails de autenticação. Se preferir seguir isso à risca, remova a linha "E-mail"/"Convite para" das tabelas (no `email_change.html` os dois endereços são o conteúdo principal e devem ficar).
