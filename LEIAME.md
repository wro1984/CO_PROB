# Problemas Sistêmicos (v1.39.0)

PWA que mostra o andamento dos chamados de problemas sistêmicos em tempo real, a partir da mesma fonte do Painel - Nível de Serviço (a consulta de problemas sistêmicos no IPTBM). Mesmas cores da empresa do painel de NS.

## Acesso e segurança
O site é **público** (GitHub Pages), então tudo o que ele publica vem **criptografado**. O app não consulta nada interno: quem lê o IPTBM, cifra e publica é o **MAPI**.

- **Entrar:** matrícula + chave de acesso. Quem libera, remove, troca a chave e envia o convite é o administrador, na aba **Comunicação → Problemas Sistêmicos · App** do MAPI. A pessoa também pode **pedir acesso pelo app** (veja abaixo).
- **Chave:** o padrão é um **código sorteado em palavras** (`lago-vento-pedra`; 3 palavras, de 2 a 5 conforme o MAPI configurar). Códigos antigos (`XXXX-XXXX-XXXX-XXXX`) continuam valendo. Como o arquivo é público, uma chave curta poderia ser descoberta por tentativa; por isso o MAPI exige **mínimo de 8 letras ou números** para chave escolhida à mão, e recomenda o código sorteado. Maiúsculas, acentos, espaços e hífens não contam.
- **Como cifra:** a chave da pessoa sai da chave digitada por PBKDF2-SHA256 (600 mil iterações, salt próprio) e abre a "chave dos dados", que vem embrulhada para cada pessoa dentro do `dados.json`. Os dados e as notificações usam AES-GCM, cada um com IV próprio. A chave dos dados muda a **cada publicação**.
- **No aparelho:** depois do primeiro acesso, a chave da pessoa fica guardada como `CryptoKey` **não extraível** (a chave digitada não é guardada). O pacote guardado continua cifrado, e o registro de mudanças vai para um **cofre cifrado** com uma chave do próprio aparelho. Nada de chamado, sistema ou notificação fica em texto aberto no armazenamento do navegador.
- **Acesso removido** (ou chave trocada) no MAPI: na próxima conferência o app **apaga tudo** o que guardou e volta para a tela de entrada. O botão **Sair** (no rodapé) faz o mesmo à mão.
- **Limite honesto:** remover um acesso vale a partir da publicação seguinte. Quem já abriu versões antigas (o histórico do Git guarda todas) mantém o que viu. Se uma chave vazar, remova o acesso e gere outra.

## Login único (HUB dos apps)
Quem entrou no **HUB dos apps** (<https://wro1984.github.io/>) neste aparelho e tem este app no perfil abre o app **sem
digitar a chave**. O botão ⌂ no topo volta para o HUB.
- O MAPI coloca no `dados.json` o campo `hub` (`{acessos: {<id do HUB>: {salt, iv, ct}}}`, id = SHA-256("hub:" + matrícula),
  salt = o do HUB): a chave dos dados embrulhada com a chave do HUB de cada pessoa que tem o app.
- O app **só lê** a credencial do HUB (IndexedDB `co-hub-acesso`, mesmo endereço): nunca apaga nem copia. Sair de todos os
  apps é no **Sair do HUB**; no rodapé daqui aparece "entrou pelo HUB", que leva para lá.
- Saiu no HUB: na próxima abertura o app apaga o que tinha guardado deste acesso e volta para a entrada (o pedido de
  acesso em andamento, se houver, fica).
- Perfil do HUB sem este app: aviso na entrada, sem recarregar sem parar. A chave própria do app continua valendo.
- Por enquanto o **aviso com o app fechado (push)** só vale para quem tem a chave própria do app; pelo HUB, o sino abre a
  janela de Atualizações com o app aberto.

## Pedir acesso pelo app
Com o endereço da caixa de entrada em `config.js` (`caixa`), a tela de entrada ganha **Solicitar acesso**: matrícula, nome, **e-mail** e (opcional) o motivo. O pedido vai para a caixa (Cloudflare), o **MAPI busca**, um administrador aprova e a chave de acesso segue **por e-mail**; o app mostra o andamento (*Em análise → Aprovado / Recusado*) e, aprovado, leva para a entrada com a matrícula já preenchida. Sem `caixa` no `config.js` nada disso aparece.
- A caixa guarda os dados do pedido só até o MAPI confirmar o recebimento. O e-mail digitado não é verificado: o administrador confere antes de aprovar.
- O código do pedido (`PS-XXXXXXXX`) e um token ficam só neste aparelho e servem apenas para acompanhar o próprio pedido.

## Avisos no celular (push)
O sino liga os avisos **neste aparelho**: novos chamados, mudanças de status e as notificações marcadas "avisar por push" chegam **mesmo com o app fechado**. O texto vem cifrado de ponta a ponta do MAPI para o aparelho (o serviço de push do navegador só repassa bytes).
- Precisa de `caixa` no `config.js` e de o MAPI ter publicado (a chave pública do push vem dentro do `dados.json`). Sem isso o sino continua avisando só com o app aberto em segundo plano.
- **iPhone:** o app precisa estar instalado na tela de início (iOS 16.4 ou mais novo). Android e desktop funcionam direto no navegador.
- Ligar pede a permissão de notificação. Sair do app, remover o acesso ou desligar o sino cancela a inscrição.
- Se o aparelho ficar sem receber, abra o app: ele confere e refaz a inscrição sozinho.

## Como os dados chegam
- O MAPI publica `dados.json` na raiz do repositório, junto do `index.html`. Sem mudança, não cria commit.
- Dentro dele, cifrados: o `sistemas.txt` (chamados) e, opcionalmente, o `notificacao.txt` (notificações cadastradas no MAPI).
- O app confere o arquivo **a cada 1 minuto** (e na hora em que a tela volta a ficar visível, ou ao tocar em ↻).
- No GitHub Pages, o app lê o arquivo **direto do repositório** (API do GitHub), sem o cache de até ~10 min do Pages. A conferência usa ETag: quando nada mudou, não gasta a cota da API. Se a API não responder, o app usa o `dados.json` do próprio site.
- Para forçar a leitura pelo arquivo do site: abra com `?fonte=arquivo` no fim do endereço.
- Sem internet o app abre com a última cópia guardada (cifrada).

## Formato dos dados (dentro do `dados.json`)
- **`dados.json`:** `app` (`problemas-sistemicos`), `v` (1), `kdf` (PBKDF2-SHA256 e nº de iterações), `acessos` (por pessoa: `salt`, `iv`, `ct`; o id é o SHA-256 de `"ps:" + matrícula`), `dados` e `notificacoes` (`iv`, `ct`).
- **`sistemas.txt`** (o que está dentro de `dados`): TXT do SQL Developer, separado por **tabulação**, cabeçalho na 1ª linha.
  - **Obrigatórias:** `ID, SISTEMA, STATUS, DATA_INICIO`.
  - **Usadas na tela:** `CHAMADO, CRITICIDADE, EVOLUCAO, SEGMENTO, IMPACTO_OPERACIONAL, DATA_FIM, TIPO_FALHA, GRUPOS_RESPONSAVEIS, GRUPOS_IMPACTADOS, AREA_ACIONADA, ALERTA_ENVIADO`.
  - **Coluna nova:** pode entrar em qualquer posição; aparece no detalhe, em "Outras colunas".
  - **Não aparecem na tela:** `FLAG, TEMPO_DECORRIDO, DADO_ATUALIZADO, DATA_ATUALIZACAO`. Continuam sendo lidas: a `DATA_ATUALIZACAO` serve para registrar "dados atualizados" nas mudanças e para escolher a linha mais recente quando um ID vem repetido.
  - **Datas:** `20/10/26 08:22:00,000000000` (também aceita `20/10/2026 08:22` e `2026-10-20 08:22:00`).

- **Campos livres com quebra de linha** (ex.: `ESTAGIO`): o Oracle exporta o texto **entre aspas**, e o app lê assim — dentro das aspas pode haver quebra de linha, tabulação e aspas (`""` = uma aspa) sem quebrar a estrutura. Se o arquivo vier cortado (aspas sem fechamento) ou com muitos registros com número de colunas diferente do cabeçalho, o app **mantém os últimos dados válidos** e avisa.

## Páginas (menu de baixo)
A barra roxa do topo (título, situação "Ao vivo", 🔔 e ↻) fica sempre fixa e visível ao rolar.

1. **Ocorrências**: sem nenhum chamado em andamento, o card verde mostra o ícone de check e, ao lado, "Nenhuma ocorrência ativa" e "Todos os sistemas operando.", centralizados na vertical; embaixo, num rodapé discreto (tudo verde), "Último normalizado:" e, em letra menor, o ID numa cápsula só com borda, o sistema e a hora ("312 PORTAL INTEGRA - LEGADO · hoje às 09:05"). Com chamado em andamento, no topo, um card grande para cada chamado em andamento, claro e "flutuando" sobre o fundo (sombra suave, cantos de 20px); a cor do tipo de falha fica na cápsula do tipo e na barra do dia:
   - nome do sistema numa linha só (nome grande termina em "…") e, à direita, o **ID** da solicitação no sistêmico (cápsula só com borda);
   - o impacto (até 2 linhas; o texto completo fica no detalhe) e a cápsula do tipo de falha por extenso seguida dos segmentos: "Indisponibilidade parcial **para B2B e B2C**";
   - o número do chamado não aparece no card, só no detalhe (toque no card);
   - selo verde **NOVO** (ou **ALTERAÇÕES**) metade dentro e metade fora do card, no canto inferior esquerdo, por 1 hora. **Tocar no selo** abre uma janela só com a **mudança mais recente** desse chamado (a que o selo anuncia), em vez do detalhe. Nessa janela, e também em **"Mudanças registradas" no detalhe do chamado**, o **Estágio aparece completo** (com as quebras de linha), e cada estágio anterior fica guardado ali mesmo que o operador sobrescreva o campo; nas listas ("Últimas alterações" e "Atualizações") ele continua abreviado numa linha com "…";
   - o tempo "aberto há" correndo ao vivo e, à direita, o status (evolução) acima do início;
   - **cronômetro** (ícone à esquerda do tempo "aberto há"; tocar no ícone **ou no próprio tempo**): abre uma janela com o tempo decorrido **correndo a cada segundo**, em horas acumuladas (ex.: `74:12:05`, sem virar dias), desde quando abriu, e embaixo a **análise do histórico** do mesmo sistema com o mesmo tipo de falha (tempo médio, maior e menor tempo), em frases curtas: "Aberto há 6h 42min: ultrapassou o maior tempo da base." e "Média a cada 34 dias (6 em 206 dias)." (sem a nota da base, para a janela ficar mais baixa) e as **últimas 3 ocorrências** desse mesmo problema numa tabelinha só com números: data e hora, tempo decorrido e **impacto no CO** (tempo dentro do expediente 08h–21h). Tocar numa linha abre o **detalhe** daquela ocorrência **por cima** da janela; ao fechar o detalhe você volta para a janela, que só fecha no botão **Fechar**. Sem ocorrências anteriores: "Não há ocorrências anteriores deste problema na base.";
   - **estágio** (`ESTAGIO`, texto do operador para o campo): enquanto o chamado está aberto e tem estágio, a cápsula do status ganha um ícone **(i)** à esquerda; o status mostra uma **bolinha roxa com o número de estágios** registrados (canto superior direito, como a do sino). Tocar no status abre a janela **Estágio** com o status (linha inteira, sem rótulo) e o **histórico de estágios**: o **atual em cima** (marcado "ATUAL"), depois os anteriores, cada um com **data e hora** e o texto completo (com as quebras de linha). O histórico é montado com as mudanças que o aparelho viu: o 1º estágio vem do "novo chamado"; se o aparelho só conheceu o chamado depois de aberto, o estágio anterior à 1ª troca vista aparece como "antes de …". No detalhe, "Estágio" aparece logo abaixo de "Alerta enviado", só com o chamado aberto. Mudança de estágio entra em "Últimas alterações" abreviada numa linha ("• **Estágio:** Restart concluído. Ativações…");
   - **alerta enviado** (`ALERTA_ENVIADO` = 1): uma **sirene branca num círculo vermelho** na quina superior direita do card (parte dentro, parte fora, sem cobrir o ID). Tocar nela abre uma janela informativa (com a própria sirene no círculo vermelho): o alerta foi enviado para **reforçar a solicitação com a área responsável**. Fecha no botão **Fechar** (embaixo, centralizado), tocando fora, no Esc ou no voltar do celular; não abre o detalhe do chamado;
   - **alfinete** à esquerda do ID para **fixar** o card no topo. Desligado fica cinza e inclinado; ligado fica roxo, cheio e em pé, e o card ganha um contorno lilás. Dá para fixar vários: o último fixado vai para o topo e os anteriores descem uma posição. Desafixado, o card volta para a ordem normal. Fica guardado **no aparelho** (cada pessoa fixa os seus);
   - por último, a **barra do dia**: expediente de hoje das 08h às 21h (traço = 14h), preenchida na cor do tipo de falha com o trecho que o chamado já ocupou hoje, até agora. Chamado que vem de ontem começa a contar às 08h de hoje. Atualiza ao vivo. Sem ocorrência, aparece o card verde "Nenhuma ocorrência ativa". Embaixo, os **chamados de hoje** (abertos primeiro, depois os encerrados) e as **últimas mudanças** de status. O número de ocorrências ativas aparece no ícone do menu.
   - **compartilhar o chamado**: no detalhe, um ícone pequeno no **canto superior direito** (não muda o layout; a seta de fechar continua sozinha no centro). Abre o compartilhamento do aparelho (WhatsApp, Teams, Outlook…) com o texto do chamado: título `*SISTEMA*` (negrito no WhatsApp), "tipo de falha · status · ID" e a lista Chamado, Início, Fim, Duração, No expediente, Segmento, Área acionada, Grupos responsáveis, Grupos impactados, Evolução, Impacto e Alerta enviado (sem mudanças registradas e sem análise do histórico). Onde o aparelho não tem compartilhamento (ex.: alguns computadores), o texto é **copiado** para colar;
   - **detalhe do chamado** (toque no card): no alto, centralizada, uma **seta para baixo** que fecha o detalhe (não há mais ✕); o **nome do sistema** alinhado à esquerda (quebra linha se for grande) e o **ID** em cápsula só com borda na ponta direita; na linha de baixo, a cápsula do **tipo de falha** na cor dele à esquerda e o **status** na ponta direita (sem a criticidade); depois as caixas **Chamado | Duração** e **Início | Fim** (tocar no chamado copia o número para a área de transferência e aparece "Chamado … copiado"), tudo do chamado (na lista de campos: Segmento, No expediente, Área acionada, Grupos responsáveis, Grupos impactados, **Evolução**, **Impacto** e Alerta enviado) e, no fim, a **Análise do histórico** do mesmo sistema com o mesmo tipo de falha, usando a base inteira (6 meses fechados + mês atual): **tempo médio**, **maior** e **menor** tempo (início → fim dos chamados encerrados, indevidos fora), se o chamado aberto está dentro ou acima da média, e a **frequência** ("ocorre em média a cada 9 dias" = dias da base ÷ ocorrências, contando desde o 1º dia do mês mais antigo do arquivo).
   - **botão de compartilhar** (círculo roxo no canto inferior direito, só na página Ocorrências), com duas opções:
     - **Compartilhar painel**: gera uma **imagem** das ocorrências ativas (mesma ordem da tela, com fixados e sirenes; sem ocorrência, o card verde) com data e hora, e manda junto o **link do app**. Onde o aparelho não envia imagem (alguns computadores), mostra a imagem com **Baixar imagem** e **Copiar link**;
     - **Compartilhar app**: mostra o **QR Code** (`icons/qrcode.svg`), o **link do próprio app** (o endereço de onde ele está rodando, ou o `appUrl` de `config.js`), **Copiar link** e atalhos para **WhatsApp**, **Teams** e **Outlook** (e-mail), — o **Teams** copia o link, avisa "Link copiado. Cole na conversa do Teams." e abre o **aplicativo** do Teams (atalho `msteams:`), sem passar pelo navegador (o Teams da empresa pede login na versão web); se o aparelho não tiver o aplicativo, o link fica copiado do mesmo jeito — além de "Outras opções" (compartilhamento do aparelho), quando houver.
2. **Histórico**: todos os chamados por dia. Ao entrar mostra o **mês atual e o anterior**; no fim da lista, o botão **"Mostrar mês de Agosto"** traz o mês seguinte para trás que tiver chamado (depois "Julho", …; de outro ano aparece "Dezembro de 2025"). Mudar busca, filtro ou sistema volta para os 2 meses. Com:
   - em **todas as listas** (Ocorrências de hoje, Últimas alterações, Histórico e listas do Painel) o **ID** aparece numa cápsula só com borda, à esquerda do nome do sistema;
   - nas listas de chamados (Ocorrências de hoje, Histórico e listas do Painel) o fundo é sempre claro (em **Ocorrências de hoje**, as já **fechadas** ganham um toque roxo bem leve no fundo e o texto um pouco mais apagado, para separar das abertas; nelas a cápsula do tipo de falha também fica em **roxo clarinho** (sem a cor do tipo), só nesta lista); a **barra da esquerda** fica na **cor forte do tipo de falha** quando o chamado está aberto e **roxo bem claro** quando está fechado (indevido: listrado no mesmo roxo); o tipo de falha aparece **por extenso** numa cápsula **discreta** (a cor do tipo bem clara, letra escura; as cores fortes ficam só nos cards), todas com a **mesma largura** e texto centralizado; a linha mostra só o **horário de início** (com a data quando não é do dia da lista); o fim e o número do chamado ficam no detalhe;
   - **busca** por texto (campo com lupa);
   - **filtro de sistema** numa lista própria do app (não a do navegador): nome à esquerda e quantidade de ocorrências (sem indevidos) numa cápsula lilás à direita. Com um sistema escolhido, a caixa mostra o nome, a quantidade e um **✕ à esquerda** para remover o filtro na hora;
   - filtro por tipo de falha (ou só indevidos).
3. **Painel**: o mesmo painel do app de NS: Dia / Semana / Mês (botão ou arrastar para o lado), filtro do dia da semana no modo Dia, seleção de coluna (toque no gráfico, na tabela ou no cabeçalho da matriz) e:
   - **cards sem comparação** com o período anterior. Sem nada selecionado, mostram o **acumulado dos 7 períodos da tela**: chamados distintos ("em 7 dias"), tempo com falha somado e o **% do expediente**, sistemas afetados e o **Período** ("14/10 a 20/10") com as **horas de expediente** somadas (dias fechados = 13h cada; o dia em andamento conta só as horas que já passaram). Com uma coluna selecionada, os mesmos cards mostram só aquele período;
   - gráfico **Tempo com falha no expediente** (o gráfico "Chamados por dia" saiu): o **fundo lilás claro** é o expediente de cada coluna (100% = expediente inteiro, todas as colunas fechadas alinhadas na mesma altura; no período em andamento o fundo sobe conforme as horas passam) e o **preenchimento** é o tempo afetado, na mesma escala. Coluna **sem falha**: uma **bolinha verde com check branco** em cima;
   - matriz **Sistemas × períodos** (sempre começa **fechada**, mostrando só Total e Chamados; abre na seta; volta a fechar ao sair e voltar para o Painel), com a linha **Chamados** embaixo do Total: quantidade de chamados de todos os sistemas (sem indevidos) em cada coluna e, à direita, os chamados distintos da tela inteira. Tocar no número abre a lista. Coluna **sem chamado**: no lugar do 0, a mesma **bolinha verde com check branco**;
   - tabela com **CHAM.** (em cápsula), **TEMPO TOTAL** (tempo com falha no período em qualquer horário), **NO EXPED.** (a parte dentro de 08h–21h) e **% EXPED.** (com barrinha na mesma escala do gráfico), tudo centralizado; a 1ª coluna mostra a data em destaque e o dia da semana embaixo; o domingo aparece em vermelho, como no gráfico.

### Compartilhar: o que sai do app (decisão)
**Compartilhar chamado** (texto) e **Compartilhar painel** (imagem das ocorrências ativas com data e hora) levam dados do chamado para fora do app (WhatsApp, Teams,
e-mail, galeria). É proposital: a divulgação em campo para os demais técnicos é parte do uso, e o conteúdo foi avaliado como não crítico. Quem recebe a imagem
ou o texto não ganha acesso ao app: para ver ao vivo, precisa ser liberado no MAPI. **Compartilhar app** envia só o link e o QR Code (`icons/qrcode.svg`, gerado para
o endereço da produção; se o endereço mudar, gere o QR de novo). Se esta decisão mudar, basta remover o botão de compartilhar (`#btShare` e as funções
`compartilhar*` em `app.js`).

## Notificações (`notificacao.txt`)
- **Origem:** cadastradas no MAPI (aba Problemas Sistêmicos · App → Notificações, com prévia) e publicadas dentro do `dados.json` cifrado, conferidas junto com os chamados (a cada 1 minuto). Sem notificações, nada aparece e os chamados seguem normais.
- Formato do `notificacao.txt` que o MAPI gera: UTF-8, tabulação, cabeçalho na 1ª linha, **1 notificação por linha**. Colunas `ID, TIPO, TITULO, TEXTO, DATA_INICIO, DATA_FIM, OBRIGATORIO, STATUS, DATA_ATUALIZACAO`. No TEXTO, quebra de linha = `\n`; marcações `{b} {i} {s} {m} {roxo} {verde} {laranja} {pink} {link=…}…{/link}`.
- **Vale só STATUS = ATIVO e dentro das datas** (relógio do aparelho, reavaliado a cada poucos segundos, sem precisar de arquivo novo): início e fim → só entre os dois; só início → a partir dele, sem prazo; só fim → já vale, até o fim; sem datas → vale enquanto estiver ativa.
- **Ícone (balão de mensagem)** à esquerda do 🔔, só quando há notificação valendo, com o **número de não lidas** (na cor do tipo mais grave entre elas).
- Tocar no ícone: com **uma** notificação abre direto; com **mais de uma** abre a **lista** (ícone + título; não lida com bolinha cheia, lida com bolinha vazada; texto e ícone ficam iguais nas duas). As **não lidas ficam sempre no topo** e as lidas descem na hora (ao voltar para a lista pelo botão ‹ redondo, ao lado do ✕); dentro de cada grupo vale a ordem abaixo. Cada notificação mostra só o **ícone do tipo**, o **título** e o **texto formatado**, com ✕ para fechar.
- Ordem: Crítico, Aviso, Informação, Interrogação; dentro do tipo, a mais recente primeiro.
- Na lista, ícone e título pequenos, em letra normal; **obrigatória ainda sem Ciente** fica num roxo um pouco mais escuro e com um **asterisco (*)** depois do título; embaixo de "Notificações" aparece a legenda "* *Necessário confirmação de leitura*" (pequena, em itálico) enquanto houver alguma pendente; o título "Notificações" e o ✕ ficam sempre no topo e só a lista rola. O título traz o contador: "(10)" quando nenhuma foi lida; depois **não lidas/total**, "(9/10)" … "(0/10)". A barra de rolagem só aparece enquanto a lista se mexe, fina e fora dos itens. Dentro da notificação, os botões ficam **embaixo**, centralizados e com a mesma largura: "‹ Voltar" (quando veio da lista) e "✕ Fechar"; nas obrigatórias, o **✓ Ciente** (roxo) fica **na mesma linha**, entre eles, com a mesma largura.
- Ícones (estilo MsgBox do VBA): Crítico ✕ no círculo vermelho; Aviso ! no triângulo amarelo; Interrogação ? no círculo roxo; Informação ! no círculo verde.
- **Obrigatória** (OBRIGATORIO = S): abre sozinha ao entrar no app (e quando chega uma nova), **uma de cada vez, na ordem do ID**: fechou uma (Ciente ou ✕), abre a próxima. Só deixa de contar com o botão **Ciente**, e depois disso não abre mais sozinha (a pessoa pode reabrir pela lista). Fechada só no ✕, volta a abrir na próxima vez que o app for aberto.
- Lida = aberta (não obrigatória) ou com Ciente (obrigatória). Fica guardado **no aparelho**. Se a notificação for editada (DATA_ATUALIZACAO nova), volta a ser não lida.
- Linha com data inválida, fim antes do início ou ID repetido: avisada no alerta amarelo do fim da página. Arquivo com erro: o app mantém as últimas notificações válidas.

## Estágio e campos com quebra de linha
O app lê `ESTAGIO` (texto livre do operador) quando a coluna existe no arquivo, e mostra a cápsula (i), a janela do estágio e a linha no log. **Sem a coluna, o app
funciona normalmente e simplesmente não mostra estágio.** O arquivo vem no formato do Oracle SQL Developer: campo com quebra de linha, tabulação ou aspas vai **entre
aspas** (`""` = uma aspa). O MAPI precisa gerar o TXT assim e liberar a coluna na consulta (ver `SIS_APP.md`, no repositório do MAPI).

## Como o Painel monta os períodos
O `sistemas.txt` tem uma linha por chamado, então os períodos são montados pelo app:
- **Dia**: os 7 últimos dias (com filtro: as 7 últimas ocorrências daquele dia da semana).
- **Semana**: as 7 últimas semanas, de segunda a domingo.
- **Mês**: os 7 últimos meses do calendário.
- Um chamado conta em todos os períodos em que esteve ativo. O tempo é o trecho dentro do **expediente 08h–21h**; no total, sobreposição conta uma vez e indevido fica fora.
- **% do expediente** = tempo com falha ÷ expediente (dia 13h; semana 7 × 13h; mês dias × 13h). No período em andamento, só as horas de expediente que já passaram.
- Período em andamento leva `*` (ainda vai crescer). Período antes do 1º chamado do arquivo fica listrado ("sem dados").

## Cores
- Falha sempre em tons de vermelho a amarelo (rosa e laranja da empresa): Indisp. total `#D61F4F`, Indisp. parcial `#F2603E`, Intermitência `#FF9901`, Lentidão `#FFC629`. Total de todos os sistemas: rosa escuro `#B4245E`.
- **Verde** para "sem ocorrência" (card do topo, dia sem chamado) e para o selo de card novo.
- Chamado encerrado e indevido: neutro (cinza-lilás).
- **Visual (v1.18):** fundo da página em degradê lilás bem suave, fixo; cards, listas e caixas brancos com sombra suave, sem borda (no escuro, roxo-escuro com sombra mais forte). Menu de baixo sem linha de divisão, no tom do fundo; o ícone da página atual fica **preenchido** em roxo. Botões do topo em vidro translúcido. A bolinha do "Ao vivo" continua como antes.

## Em andamento
- Chamado em andamento = `STATUS` ABERTO. Status desconhecido conta como em andamento enquanto não tiver `DATA_FIM`. FECHADO e INDEVIDO nunca contam.
- Ordem: criticidade (P0 primeiro) e, dentro dela, o aberto há mais tempo. Selo verde **NOVO** ou **ALTERAÇÕES** fica 1 hora no card.

## Últimas alterações
- Os títulos **Ocorrências ativas**, **Ocorrências de hoje** e **Últimas alterações** seguem o mesmo padrão: a quantidade fica numa cápsula roxa clarinha logo depois do texto (em Ocorrências ativas ela fica vermelha quando há chamado aberto). Em Últimas alterações, o "Ver todas" fica no canto direito.
- Funciona como um **log** discreto, para não concorrer com os chamados: hora (e data, se for de outro dia) à esquerda; em letra pequena o ID e o sistema; embaixo, em letra menor ainda, **uma linha com marcador para cada campo que mudou**: "• **Evolução:** Realizando restart", "• **Status:** Fechado", "• **Fim:** 22/10 12:40" (só o valor que entrou, sem o anterior). Chamado novo: "• **Novo chamado**", "• **Status:** Aberto". O número do chamado não aparece no log.
- A cada arquivo novo, o app compara cada `ID` com o anterior e registra: chamado novo; mudança em **qualquer campo** do chamado (sistema, chamado, status, criticidade, evolução, segmento, impacto, início, fim, tipo de falha, grupos responsáveis, grupos impactados, área acionada e alerta enviado; só ficam de fora os campos de controle `DATA_ATUALIZACAO`, `DADO_ATUALIZADO`, `TEMPO_DECORRIDO` e `FLAG`); dados atualizados; chamado que saiu do arquivo. Mais de 3 sumindo de uma vez vira alerta.
- O registro fica **no aparelho** (últimas 300 mudanças).
- Limpeza automática: registros com ID inválido (com espaço ou aspas — restos de versões anteriores à 1.30, que partiam o arquivo quando o estágio tinha quebra de linha) são apagados ao abrir o app; se a cópia de comparação estiver corrompida, ela é descartada e a comparação recomeça no próximo arquivo, sem gerar mudanças falsas.
- **Resumo (sempre, para todos):** a cada conferência com mudança, o balão roxo embaixo mostra a mudança (ou "N mudanças · toque para ver") e some sozinho.
- **Novo chamado** no log ("Últimas alterações", "Mudanças registradas" do detalhe, janela do selo e janela Atualizações) aparece numa **cápsula verde com letra branca**, para destacar o chamado que entrou.
- **🔔 Atualizações detalhadas (opcional):** com o sino ligado, cada mudança entra numa janela **"Atualizações (n)"** no mesmo padrão das outras janelas (ícone do sino num círculo roxo), com os itens no formato do log (hora, ID, sistema e os campos que mudaram). As mudanças **se acumulam até o "✓ Ciente"**; "✕ Fechar" só fecha (a lista fica guardada, e o sino mostra um número com as pendentes — tocar no sino abre a janela de novo). Tocar num item abre o detalhe do chamado **por cima** da janela; ao fechar o detalhe você volta para a lista e pode ver os outros itens (a janela só fecha no **Fechar** ou no **Ciente**). A janela espera fechar outra janela que esteja aberta (notificação, detalhe, cronômetro). Embaixo, "Desligar atualizações detalhadas". **Acima da lista**, uma cápsula para cada ID com uma **bolinha roxa com o número** de atualizações (branco) encostada no canto superior direito, como a do sino. Tocar numa cápsula **filtra** só aquele chamado (a cápsula fica roxa com o ID branco, a bolinha fica roxinho-claro com o número roxo, e aparece um ✕ redondo à esquerda); tocar nela de novo ou no ✕ tira o filtro. Com o filtro ligado aparece um **+ num círculo** à direita, no começo da linha das cápsulas (clarinho como o ✕): tocando nele, liga a **seleção múltipla** (o + fica roxo) e cada ID tocado entra ou sai da seleção, mostrando vários chamados de uma vez; tocar no + de novo desliga e fica só o primeiro escolhido. **Ciente com filtro** confirma só as atualizações dos chamados selecionados (as outras continuam na lista); **Ciente sem filtro** confirma todas.
- O sino **não depende da permissão de notificação do navegador**: a janela funciona mesmo sem ela. Ao ligar, o app pede a permissão e, se o navegador permitir e o MAPI tiver publicado o push, liga **também o aviso com o app fechado** (veja "Avisos no celular (push)"); sem push, avisa na barra do aparelho só enquanto o app estiver aberto em segundo plano. Ao voltar para o app, a janela já mostra tudo o que mudou (só o resultado final de cada chamado, sem as versões intermediárias). Desligar o sino desliga as duas coisas.
- A lista de atualizações sem Ciente fica no **cofre cifrado** do aparelho, junto com o registro de mudanças e os cards fixados (nada de chamado em texto aberto).

## Conferência dos dados
- Arquivo sem as colunas obrigatórias, sem tabulação ou sem linhas válidas: o app **não troca** os dados, mantém os últimos válidos e mostra alerta vermelho.
- Linha com `DATA_INICIO` inválida é ignorada; `DATA_FIM` inválida vira "sem fim"; `ID` repetido fica com a linha de atualização mais recente. Os avisos aparecem num alerta amarelo no fim da página, como último item (toque para ver a lista). Erros do arquivo e falha ao guardar continuam em vermelho no topo.
- Se o aparelho não conseguir guardar a cópia, aparece alerta vermelho.
- Sem internet, o app abre com a última cópia guardada.


## Pré-visualização do link
- O `index.html` tem as etiquetas de pré-visualização (Open Graph): ao colar ou compartilhar o link no WhatsApp, Teams, Outlook etc., aparece o card com a imagem `icons/og-image.jpg` (1200×630, ícone + nome do app), o título e a descrição. A imagem precisa estar publicada no endereço `https://wro1984.github.io/CO_PROB/icons/og-image.jpg` (o repositório tem de ser público para os apps conseguirem ler).
- Esses apps guardam a pré-visualização por um tempo: um link que já foi compartilhado antes sem imagem pode continuar sem ela por alguns dias. Para testar na hora, compartilhe com um parâmetro novo no fim, ex.: `…/CO_PROB/?v=2`.

## Publicar
1. No repositório fica só o app (sem dados). O `dados.json` é criado e atualizado **pelo MAPI**; não edite nem suba esse arquivo à mão.
2. Ative o GitHub Pages (branch principal, pasta raiz).
3. No MAPI (`.env`): `SIS_APP_GITHUB_TOKEN` (token fine-grained com Contents read/write só neste repositório), `SIS_APP_GITHUB_REPO`, `SIS_APP_URL` e `SIS_APP_SECRET_KEY`. Na aba Comunicação → Problemas Sistêmicos · App: cadastre os acessos, entregue os códigos e ligue a publicação automática.
4. **Pedidos e avisos (opcional):** publique a caixa de entrada (`worker/README.md`), ponha o endereço em `config.js` e configure `SIS_APP_CAIXA_*` no MAPI.
5. A cada mudança no app, aumente a versão em `app.js` (`VERSION`), `painel.js`, `notif.js`, `cripto.js`, `caixa.js`, `push.js` (`VERSAO`) e `sw.js` (`VERSION`), com o mesmo número, e nas `?v=` do `index.html`. O app confere os arquivos de segurança com a própria versão.

## Testes
`npm test` (ou `node --test tests/cripto.test.js tests/formato.test.js tests/caixa.test.js tests/push.test.js`) (Node 18 ou mais novo, sem dependências). Usam `tests/fixtures/pacote.json`, gerado pelo MAPI (inclui o segredo de push e uma prova de inscrição calculada pelo MAPI, que o app precisa reproduzir) (`tests/gerar_fixture_sis_app.py` do repositório do MAPI), e conferem que o app abre o que o MAPI cifra e lê os TXT que o MAPI gera. Se o formato do pacote ou dos TXT mudar, gere o arquivo de novo.
