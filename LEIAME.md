# Problemas Sistêmicos (v1.18.0)

PWA que mostra o andamento dos chamados de problemas sistêmicos em tempo real, a partir da mesma fonte do Painel - Nível de Serviço (a consulta de problemas sistêmicos no IPTBM). Mesmas cores da empresa do painel de NS.

## Acesso e segurança
O site é **público** (GitHub Pages), então tudo o que ele publica vem **criptografado**. O app não consulta nada interno: quem lê o IPTBM, cifra e publica é o **MAPI**.

- **Entrar:** matrícula + chave de acesso. Quem libera, remove, troca a chave e envia o convite é o administrador, na aba **Magic → Problemas Sistêmicos · App** do MAPI. A pessoa também pode **pedir acesso pelo app** (veja abaixo).
- **Chave:** o padrão é um **código sorteado** (`XXXX-XXXX-XXXX-XXXX`, 80 bits). Como o arquivo é público, uma chave curta poderia ser descoberta por tentativa; por isso o MAPI exige **mínimo de 8 letras ou números** para chave escolhida à mão, e recomenda o código sorteado. Maiúsculas, acentos, espaços e hífens não contam.
- **Como cifra:** a chave da pessoa sai da chave digitada por PBKDF2-SHA256 (600 mil iterações, salt próprio) e abre a "chave dos dados", que vem embrulhada para cada pessoa dentro do `dados.json`. Os dados e as notificações usam AES-GCM, cada um com IV próprio. A chave dos dados muda a **cada publicação**.
- **No aparelho:** depois do primeiro acesso, a chave da pessoa fica guardada como `CryptoKey` **não extraível** (a chave digitada não é guardada). O pacote guardado continua cifrado, e o registro de mudanças vai para um **cofre cifrado** com uma chave do próprio aparelho. Nada de chamado, sistema ou notificação fica em texto aberto no armazenamento do navegador.
- **Acesso removido** (ou chave trocada) no MAPI: na próxima conferência o app **apaga tudo** o que guardou e volta para a tela de entrada. O botão **Sair** (no rodapé) faz o mesmo à mão.
- **Limite honesto:** remover um acesso vale a partir da publicação seguinte. Quem já abriu versões antigas (o histórico do Git guarda todas) mantém o que viu. Se uma chave vazar, remova o acesso e gere outra.

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

## Páginas (menu de baixo)
A barra roxa do topo (título, situação "Ao vivo", 🔔 e ↻) fica sempre fixa e visível ao rolar.

1. **Ocorrências**: no topo, um card grande para cada chamado em andamento, com fundo branco tingido pela cor do tipo de falha e texto no tom escuro da mesma cor:
   - nome do sistema numa linha só (nome grande termina em "…") e, à direita, o **ID** da solicitação no sistêmico (cápsula só com borda);
   - o impacto (até 2 linhas; o texto completo fica no detalhe) e a cápsula do tipo de falha por extenso seguida dos segmentos: "Indisponibilidade parcial **para B2B e B2C**";
   - o número do chamado não aparece no card, só no detalhe (toque no card);
   - selo verde **NOVO** (ou **MUDOU**) metade dentro e metade fora do card, no canto inferior esquerdo, por 1 hora;
   - o tempo "aberto há" correndo ao vivo e, à direita, o status (evolução) acima do início;
   - por último, a **barra do dia**: expediente de hoje das 08h às 21h (traço = 14h), preenchida na cor do tipo de falha com o trecho que o chamado já ocupou hoje, até agora. Chamado que vem de ontem começa a contar às 08h de hoje. Atualiza ao vivo. Sem ocorrência, aparece o card verde "Nenhuma ocorrência ativa". Embaixo, os **chamados de hoje** (abertos primeiro, depois os encerrados) e as **últimas mudanças** de status. O número de ocorrências ativas aparece no ícone do menu.
   - **detalhe do chamado** (toque no card): no alto, centralizada, uma **seta para baixo** que fecha o detalhe (não há mais ✕); o **nome do sistema** alinhado à esquerda (quebra linha se for grande) e o **ID** em cápsula só com borda na ponta direita; na linha de baixo, a cápsula do **tipo de falha** na cor dele à esquerda e o **status** na ponta direita (sem a criticidade); depois as caixas **Chamado | Duração** e **Início | Fim** (tocar no chamado copia o número para a área de transferência e aparece "Chamado … copiado"), tudo do chamado (na lista de campos: Segmento, No expediente, Área acionada, Grupos responsáveis, Grupos impactados, **Evolução**, **Impacto** e Alerta enviado) e, no fim, a **Análise do histórico** do mesmo sistema com o mesmo tipo de falha, usando a base inteira (6 meses fechados + mês atual): **tempo médio**, **maior** e **menor** tempo (início → fim dos chamados encerrados, indevidos fora), se o chamado aberto está dentro ou acima da média, e a **frequência** ("ocorre em média a cada 9 dias" = dias da base ÷ ocorrências, contando desde o 1º dia do mês mais antigo do arquivo).
2. **Histórico**: todos os chamados por dia, com:
   - em **todas as listas** (Chamados de hoje, Últimas mudanças, Histórico e listas do Painel) o **ID** aparece numa cápsula só com borda, à esquerda do nome do sistema;
   - **busca** por texto (campo com lupa);
   - **filtro de sistema** numa lista própria do app (não a do navegador): nome à esquerda e quantidade de ocorrências (sem indevidos) numa cápsula lilás à direita. Com um sistema escolhido, a caixa mostra o nome, a quantidade e um **✕ à esquerda** para remover o filtro na hora;
   - filtro por tipo de falha (ou só indevidos).
3. **Painel**: o mesmo painel do app de NS: Dia / Semana / Mês (botão ou arrastar para o lado), filtro do dia da semana no modo Dia, seleção de coluna (toque no gráfico, na tabela ou no cabeçalho da matriz) e:
   - **cards sem comparação** com o período anterior. Sem nada selecionado, mostram o **acumulado dos 7 períodos da tela**: chamados distintos ("em 7 dias"), tempo com falha somado e o **% do expediente**, sistemas afetados e o **Período** ("14/10 a 20/10") com as **horas de expediente** somadas (dias fechados = 13h cada; o dia em andamento conta só as horas que já passaram). Com uma coluna selecionada, os mesmos cards mostram só aquele período;
   - gráfico **Tempo com falha no expediente** (o gráfico "Chamados por dia" saiu): o **fundo lilás claro** é o expediente de cada coluna (100% = expediente inteiro, todas as colunas fechadas alinhadas na mesma altura; no período em andamento o fundo sobe conforme as horas passam) e o **preenchimento** é o tempo afetado, na mesma escala;
   - matriz **Sistemas × períodos** (sempre começa **fechada**, mostrando só Total e Chamados; abre na seta; volta a fechar ao sair e voltar para o Painel), com a linha **Chamados** embaixo do Total: quantidade de chamados de todos os sistemas (sem indevidos) em cada coluna e, à direita, os chamados distintos da tela inteira. Tocar no número abre a lista;
   - tabela com **CHAM.** (em cápsula), **TEMPO TOTAL** (tempo com falha no período em qualquer horário), **NO EXPED.** (a parte dentro de 08h–21h) e **% EXPED.** (com barrinha na mesma escala do gráfico), tudo centralizado; a 1ª coluna mostra a data em destaque e o dia da semana embaixo; o domingo aparece em vermelho, como no gráfico.

## Notificações (`notificacao.txt`)
- **Origem:** cadastradas no MAPI (aba Problemas Sistêmicos · App → Notificações, com prévia) e publicadas dentro do `dados.json` cifrado, conferidas junto com os chamados (a cada 1 minuto). Sem notificações, nada aparece e os chamados seguem normais.
- Formato do `notificacao.txt` que o MAPI gera: UTF-8, tabulação, cabeçalho na 1ª linha, **1 notificação por linha**. Colunas `ID, TIPO, TITULO, TEXTO, DATA_INICIO, DATA_FIM, OBRIGATORIO, STATUS, DATA_ATUALIZACAO`. No TEXTO, quebra de linha = `\n`; marcações `{b} {i} {s} {m} {roxo} {verde} {laranja} {pink} {link=…}…{/link}`.
- **Vale só STATUS = ATIVO e dentro das datas** (relógio do aparelho, reavaliado a cada poucos segundos, sem precisar de arquivo novo): início e fim → só entre os dois; só início → a partir dele, sem prazo; só fim → já vale, até o fim; sem datas → vale enquanto estiver ativa.
- **Ícone (balão de mensagem)** à esquerda do 🔔, só quando há notificação valendo, com o **número de não lidas** (na cor do tipo mais grave entre elas).
- Tocar no ícone: com **uma** notificação abre direto; com **mais de uma** abre a **lista** (ícone + título; não lida com bolinha cheia, lida com bolinha vazada; texto e ícone ficam iguais nas duas). As **não lidas ficam sempre no topo** e as lidas descem na hora (ao voltar para a lista pelo botão ‹ redondo, ao lado do ✕); dentro de cada grupo vale a ordem abaixo. Cada notificação mostra só o **ícone do tipo**, o **título** e o **texto formatado**, com ✕ para fechar.
- Ordem: Crítico, Aviso, Informação, Interrogação; dentro do tipo, a mais recente primeiro.
- Ícones (estilo MsgBox do VBA): Crítico ✕ no círculo vermelho; Aviso ! no triângulo amarelo; Interrogação ? no círculo roxo; Informação ! no círculo verde.
- **Obrigatória** (OBRIGATORIO = S): abre sozinha ao entrar no app (e quando chega uma nova), **uma de cada vez, na ordem do ID**: fechou uma (Ciente ou ✕), abre a próxima. Só deixa de contar com o botão **Ciente**, e depois disso não abre mais sozinha (a pessoa pode reabrir pela lista). Fechada só no ✕, volta a abrir na próxima vez que o app for aberto.
- Lida = aberta (não obrigatória) ou com Ciente (obrigatória). Fica guardado **no aparelho**. Se a notificação for editada (DATA_ATUALIZACAO nova), volta a ser não lida.
- Linha com data inválida, fim antes do início ou ID repetido: avisada no alerta amarelo do fim da página. Arquivo com erro: o app mantém as últimas notificações válidas.

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

## Em andamento
- Chamado em andamento = `STATUS` ABERTO. Status desconhecido conta como em andamento enquanto não tiver `DATA_FIM`. FECHADO e INDEVIDO nunca contam.
- Ordem: criticidade (P0 primeiro) e, dentro dela, o aberto há mais tempo. Selo verde **NOVO** ou **MUDOU** fica 1 hora no card.

## Últimas mudanças
- A cada arquivo novo, o app compara cada `ID` com o anterior e registra: chamado novo; mudança de `STATUS`, `EVOLUCAO`, `DATA_FIM`, `CRITICIDADE` ou `TIPO_FALHA`; dados atualizados; chamado que saiu do arquivo. Mais de 3 sumindo de uma vez vira alerta.
- O registro fica **no aparelho** (últimas 300 mudanças).
- 🔔 liga avisos do aparelho com o app aberto (mesmo em segundo plano). Com o app fechado não há aviso: isso exige um serviço de envio (push).

## Conferência dos dados
- Arquivo sem as colunas obrigatórias, sem tabulação ou sem linhas válidas: o app **não troca** os dados, mantém os últimos válidos e mostra alerta vermelho.
- Linha com `DATA_INICIO` inválida é ignorada; `DATA_FIM` inválida vira "sem fim"; `ID` repetido fica com a linha de atualização mais recente. Os avisos aparecem num alerta amarelo no fim da página, como último item (toque para ver a lista). Erros do arquivo e falha ao guardar continuam em vermelho no topo.
- Se o aparelho não conseguir guardar a cópia, aparece alerta vermelho.
- Sem internet, o app abre com a última cópia guardada.

## Publicar
1. No repositório fica só o app (sem dados). O `dados.json` é criado e atualizado **pelo MAPI**; não edite nem suba esse arquivo à mão.
2. Ative o GitHub Pages (branch principal, pasta raiz).
3. No MAPI (`.env`): `SIS_APP_GITHUB_TOKEN` (token fine-grained com Contents read/write só neste repositório), `SIS_APP_GITHUB_REPO`, `SIS_APP_URL` e `SIS_APP_SECRET_KEY`. Na aba Magic → Problemas Sistêmicos · App: cadastre os acessos, entregue os códigos e ligue a publicação automática.
4. **Pedidos e avisos (opcional):** publique a caixa de entrada (`worker/README.md`), ponha o endereço em `config.js` e configure `SIS_APP_CAIXA_*` no MAPI.
5. A cada mudança no app, aumente a versão em `app.js` (`VERSION`), `painel.js`, `notif.js`, `cripto.js`, `caixa.js`, `push.js` (`VERSAO`) e `sw.js` (`VERSION`), com o mesmo número, e nas `?v=` do `index.html`. O app confere os arquivos de segurança com a própria versão.

## Testes
`npm test` (ou `node --test tests/cripto.test.js tests/formato.test.js tests/caixa.test.js tests/push.test.js`) (Node 18 ou mais novo, sem dependências). Usam `tests/fixtures/pacote.json`, gerado pelo MAPI (inclui o segredo de push e uma prova de inscrição calculada pelo MAPI, que o app precisa reproduzir) (`tests/gerar_fixture_sis_app.py` do repositório do MAPI), e conferem que o app abre o que o MAPI cifra e lê os TXT que o MAPI gera. Se o formato do pacote ou dos TXT mudar, gere o arquivo de novo.
