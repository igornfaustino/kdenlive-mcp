# Estado do projeto

Atualizado em **2026-10-15**, baseado nos arquivos reais do checkout. Importação:
`659fdf2`; correção FourCC: `d992ca7`; aceitação com importação real: `329d243`.
As alterações locais descritas no histórico abaixo já foram commitadas. README,
checklists e evidências foram reconciliados no fechamento desta etapa.

## Resumo

Existe uma biblioteca TypeScript funcional e um servidor MCP por stdio para
editar projetos Kdenlive salvos, preservando spans de XML não afetados. Cortes,
volume/fades, posicionamento de áudio e importação limitada de WAV estão no
código. O projeto completo ainda está em desenvolvimento. Após a correção
FourCC descrita abaixo, **105 testes passam**, em sete arquivos de teste;
checagem de tipos, build e aceitação stdio também passaram.

A importação já está implementada e o bug confirmado de identificadores FourCC
foi corrigido. O suporte continua limitado ao subconjunto WAV documentado.

## Implementado no código

| Área | Comportamento existente | Fonte |
| --- | --- | --- |
| Biblioteca/CLI | ESM TypeScript, Project e Workspace exportados; CLI com raízes explícitas e stdio | `src/index.ts`, `src/cli.ts` |
| XML | Parsing saxes, spans originais, IDs únicos, referências de entry/track, patches sem sobreposição, recusa de DTD | `src/core/xml.ts` |
| Modelo | Projeção de sequências, tracks, playlists, clips, FPS e duração calculada pelos segmentos | `src/core/model.ts` |
| Tempo | Frames inteiros seguros, ranges semiabertos, conversão de relógios MLT com FPS racional e BigInt | `src/core/time.ts` |
| Transações | expectedRevision, string candidata por batch, validação antes da troca, uma operação por track por batch | `src/core/project.ts`, `src/core/editing.ts` |
| Corte | split_clip divide sem alterar duração; remove_ranges fecha espaços apenas na track escolhida | `src/core/editing.ts` |
| Áudio | Ganho e fades no entry selecionado, reconhecimento/substituição de pilhas gerenciadas e isolamento de instâncias da mesma fonte | `src/core/audio.ts` |
| Música | Inserção de fonte do bin em espaço livre ou após o fim; substituição preservando posição/duração; clone com ID XML único antes da playlist | `src/core/music.ts` |
| Importação WAV | Referência absoluta no bin, IDs disponíveis, duração em frames completos, inspeção de headers sem carregar payload inteiro | `src/core/import-audio.ts`, `src/io/wave.ts` |
| Arquivos/sessões | Raízes canônicas, symlinks, até 32 sessões, busy em save/import, inspeção de mídia e detecção de alteração do projeto original | `src/io/workspace.ts` |
| Save As | Novo arquivo irmão, temporário exclusivo sincronizado, publicação por hard link e recusa de sobrescrita | `src/io/workspace.ts` |
| Integração MCP | Schemas Zod, resultados estruturados e erros com código/mensagem | `src/mcp/server.ts` |
| Desenvolvimento | Sete suítes Vitest, scripts de aceitação, workflow Ubuntu/macOS e dez skills locais preferidas | `tests/`, `scripts/`, `.github/workflows/check.yml`, `.agents/skills/` |

### Ferramentas MCP existentes

Há **sete**, registradas em `src/mcp/server.ts`:

- `project_open`: abre arquivo salvo dentro das raízes permitidas.
- `project_info`: retorna revisão, sequência, tracks, clips e mídia.
- `project_validate`: verifica disponibilidade/caminhos de mídia reconhecida;
  não certifica decodificação nem compatibilidade com o editor.
- `project_import_audio`: importa referência WAV PCM16 mono/estéreo no bin,
  retornando `sourceId`, `durationFrames` e estado atualizado.
- `timeline_apply`: aplica `remove_ranges`, `split_clip`, `set_clip_audio`,
  `insert_audio_clip` ou `replace_audio_clip`.
- `project_save_as`: persiste uma revisão em novo `.kdenlive` irmão.
- `project_close`: libera sessão e descarta mudanças ainda não salvas.

Importar não insere automaticamente na timeline. É necessário chamar
`timeline_apply` com o `sourceId` retornado e a nova revisão, depois Save As.
O arquivo de mídia original é referenciado, sem cópia ou transcodificação.

## Limites atuais

- Timeline: versão documental `1.1`, uma sequência, duas playlists por track e
  no máximo uma com segmentos. Importação exige versão `1.1`, sequência única e
  main_bin playlist não self-closing; não usa todas as checagens da timeline.
- Grupos, mixes, referências temporais não modeladas, tracks bloqueadas,
  transições de usuário e efeitos não aceitos são recusados na edição.
- Cortes temporais recusam efeitos nos clips da track afetada. Substituição de
  áudio exige alvo sem efeitos/links. Não existe retiming geral de efeitos.
- Ganho limitado a -60/+20 dB; cada fade é zero ou pelo menos dois frames e a
  soma não excede a duração. Só pilhas gerenciadas reconhecidas são substituídas.
- Inserção de áudio recusa sobreposição; não implementa mix/crossfade ou ripple
  de inserção. Remover toda a duração de uma track também é recusado.
- A fonte de música deve ser áudio-only habilitado, sem efeitos/links aceitos
  apenas por suposição, e ter referência única no bin e range disponível.
- WAV: little-endian RIFF, PCM inteiro de 16 bits, mono/estéreo, um fmt clássico
  de 16/18 bytes, um data não vazio, alinhamento/byte rate coerentes e até 1024
  chunks. Formatos comprimidos, float, extensible e RF64 não são suportados.
  A duração usa piso; menos de um frame completo é recusado.
- Projetos UTF-8 de até 16 MiB; parser limitado a 128 níveis e 200 mil nós.
- Save As exige mídia local reconhecida dentro das raízes; mídia relativa exige
  XML root absoluto. O sistema de arquivos precisa suportar hard links.
- O hash protege o projeto original contra mudanças externas antes da publicação;
  não congela os arquivos de mídia. Há checagem de identidade/tamanho/tempos do
  WAV durante inspeção, mas mídia pode mudar após o retorno.
- A persistência não garante sync do diretório após queda de energia nem proteção
  contra substituição hostil concorrente de diretórios. Uma falha de limpeza pode
  ser reportada após o destino já ter sido publicado.

## Correção FourCC e histórico da importação

### FourCC WAV: corrigido em 2026-10-15

`src/io/wave.ts` usava `Buffer.toString("ascii")` para comparar RIFF, WAVE e os
identificadores de chunks. Essa decodificação remove o bit alto; um byte alterado
com `| 0x80` pode ser reconhecido como se fosse o identificador original.

Os quatro casos locais em `tests/import.test.ts` alteram os offsets 0, 8, 12 e
36 da fixture e esperam rejeição. As quatro falhas foram reproduzidas antes da
correção. A leitura agora usa `latin1`, que preserva todos os bits e impede que
identificadores corrompidos sejam reconhecidos como RIFF, WAVE, fmt ou data.
`tests/wave.test.ts` acrescenta 16 casos, cobrindo cada byte desses quatro
identificadores e exigindo o código `INVALID_AUDIO`. Todos falharam antes da
correção e passaram depois; WAV válido e chunks adicionais continuam cobertos
pelos testes de importação existentes.

### Alterações locais preexistentes — agora commitadas

Antes de criar esta documentação, `git status --short` mostrava:

| Arquivo | Alteração ainda fora de commit |
| --- | --- |
| `tests/import.test.ts` | Quatro testes de regressão FourCC, agora passando após a correção |
| `scripts/music-acceptance.mjs` | Troca da montagem artificial do bin por Workspace.importAudio e verificações da duração do bin após Save As nativo |

Esses arquivos não foram alterados nem incluídos no commit desta tarefa. O
script modificado já produziu evidência local bem-sucedida; na análise documental,
os quatro testes de corrupção ainda falhavam. A lista acima é um retrato da análise, não uma
promessa de que o checkout continuará nesse estado.

No fechamento da etapa, o checkout estava limpo: os testes de importação fazem
parte de `d992ca7`, e o script de aceitação faz parte de `329d243`.

### Documentação reconciliada

`README.md` agora lista sete ferramentas, 105 testes e o fluxo de importação WAV,
incluindo revisão, inserção explícita e Save As. `docs/verification.md` registra
a checagem atual e a nova medição da cópia nativa existente;
`docs/implementation-plan.md` e `docs/import-audio-design.md` marcam a importação
limitada como entregue. Outros codecs, vídeo/efeitos e jobs MCP seguem pendentes.

## Testes existentes e resultados observados

### Suítes Vitest

| Arquivo | Cobertura existente |
| --- | --- |
| `tests/core.test.ts` | Parsing/preservação, split/removal, rollback, revisões, fronteiras de blanks/clips, FPS racional, layouts recusados e proteção de atributos XML |
| `tests/audio.test.ts` | Isolamento por entry, limites de ganho/fades, reconfiguração/remoção, pilhas desconhecidas, fontes recusadas e fixture salva nativamente |
| `tests/music.test.ts` | Faixa vazia, preenchimento de blank, anexação/duração, sobreposição, fontes/ranges inválidos, substituição e preservação de metadados |
| `tests/workspace.test.ts` | Save As exclusivo, alteração externa, revisões, traversal/symlinks, mídia ausente/proibida, roots ambíguos, limites e corrida de saves |
| `tests/mcp.test.ts` | Cliente/servidor in-memory: descoberta das sete ferramentas, edição, schemas/erros, validação, save e close |
| `tests/import.test.ts` | WAV/metadados, formatos inválidos, importação/inserção/save, duplicatas/aliases, rollback, busy, preservação, estéreo e os quatro casos FourCC locais |
| `tests/wave.test.ts` | Rejeição de corrupção em cada byte dos quatro identificadores FourCC obrigatórios, com código INVALID_AUDIO |

Na análise documental de 2026-10-15, antes da correção FourCC:

- `pnpm check`: checagem de tipos passou; Vitest executou **89 testes: 85 passaram,
  quatro falharam**, todos no caso FourCC de importação. Cinco arquivos passaram,
  um falhou. O comando terminou com erro e não chegou ao seu passo de build.
- `pnpm test:stdio`: inclui build e execução de um cliente MCP oficial em processo
  separado. **Passou nesta análise**, incluindo build, descoberta das sete
  ferramentas, importação/substituição, save e preservação do original.

Não há script de lint ou meta de cobertura configurados. Os testes normais não
exigem Kdenlive instalado. A presença de testes para um comportamento não
significa que todos os arquivos Kdenlive que o usam sejam compatíveis.

Após a correção FourCC, no mesmo dia, `pnpm check` passou por todas as etapas:
checagem de tipos, **105 testes em sete arquivos** e build. `pnpm test:stdio`
também passou, incluindo seu build e o fluxo MCP em processo separado.
A contagem inclui os quatro testes locais preexistentes de importação e os
16 novos casos de `tests/wave.test.ts`. Não houve nova aceitação pela interface
do Kdenlive nesta correção de cabeçalhos.

No fechamento documental, `pnpm check` e `pnpm test:stdio` foram executados
novamente e passaram, incluindo os 105 testes e build.

### Scripts de aceitação

| Comando | O que verifica | Dependências extras |
| --- | --- | --- |
| `pnpm test:stdio` | CLI real, sete ferramentas, cortes, áudio, importação/substituição, validação, Save As e preservação do original | Nenhum editor |
| `pnpm test:native` | Renderiza fixture original/editada; conta 250/175 frames e verifica stream de áudio | melt e ffprobe |
| `pnpm test:audio` | Mede RMS, trecho preservado, -6 dB e fades; opcionalmente compara cópia nativa e controle nativo | melt |
| `pnpm test:music` | Mede 440/880 Hz antes/durante/depois da inserção/substituição; checkout atual usa importação real | melt |

Os scripts nativos geram artefatos ignorados em `.artifacts/`. A execução padrão
não automatiza a interface do Kdenlive. Os caminhos opcionais nos scripts de
áudio/música permitem medir cópias previamente salvas pelo editor.

### Evidência nativa disponível

As fixtures e `docs/verification.md` registram testes em macOS Apple Silicon,
Kdenlive 26.08.2 e MLT 7.43.0. A fixture base é um tom sintético original de 440 Hz,
10 segundos, 8 kHz mono PCM16, com quatro tracks. A segunda fixture captura a
pilha de áudio após salvar pelo editor. Consulte `tests/fixtures/README.md`.

No trabalho imediatamente anterior à tarefa documental, a nova importação de
um tom de 880 Hz foi aberta no Kdenlive e salva em
`.artifacts/music-OHqsWj/import-roundtrip.kdenlive`. O relatório local
`.artifacts/music-bBuucs/report.json`, conferido nesta análise, registra:

- original e saída gerada: 10 segundos;
- cópia nativa: 10,04 segundos;
- presença de 440 Hz antes da música, 440/880 Hz durante a sobreposição e apenas
  880 Hz após a substituição, com as mesmas amplitudes na saída gerada/nativa;
- execução bem-sucedida do script modificado, incluindo ranges dos três clips e
  duração de 250 frames da mídia importada no bin após a gravação nativa.

Não foi feita uma nova sessão gráfica nesta tarefa. Artefatos locais não fazem
parte do clone. Um frame extra após Save As dessa fixture também foi observado
no controle original sem edição, como documentado em `docs/verification.md`.
Isso é uma limitação conhecida dessa evidência; não demonstra duração arbitrária
correta em todo projeto. Aceitação de vídeo, efeitos/transições de usuário,
múltiplas sequências e editor nativo Linux/Windows permanece não verificada.

O fechamento repetiu `pnpm test:music` com a cópia nativa existente acima.
`.artifacts/music-OELDdh/report.json` confirma os mesmos ranges, duração de
250 frames no bin e amplitudes, com 10 segundos na saída gerada e 10,04 segundos
na cópia nativa. Não houve nova abertura/gravação pela GUI nesta etapa.

CI está configurado em `.github/workflows/check.yml` para Ubuntu/macOS, Node.js
24, `pnpm check` e `pnpm test:stdio`. Não há evidência nesta análise de execução
remota do workflow. O pacote está marcado `private: true`; não há fluxo de release
configurado nos arquivos inspecionados.

## Funcionalidades ausentes e próximos passos

Esta lista é orientação futura, não trabalho realizado nesta tarefa:

O fechamento da importação WAV e a atualização documental estão concluídos.
Próximas etapas:

1. Ampliar importação para outros formatos de áudio apenas com uma estratégia
   explícita de inspeção/validação; não há integração ffprobe em produção hoje.
2. Planejar operações de vídeo e efeitos/transições além do subconjunto atual,
   incluindo fixtures e aceitação no editor. Cortes genéricos de playlists não
   constituem uma suíte nativa de vídeo validada.
3. Planejar ferramentas MCP de renderização e seu ciclo de execução; os scripts
   de desenvolvimento existentes ainda não implementam jobs MCP.
4. Validar o editor nativo em Linux/Windows e executar a CI remotamente quando
   houver um fluxo de publicação autorizado.

Não existem ferramentas para criar projeto do zero, gerar narração, detectar
silêncios automaticamente, controlar a GUI ao vivo ou manipular múltiplas
sequências. O usuário fornece ranges; o servidor não faz análise editorial do
conteúdo. Não tratar essas possibilidades do projeto original como entregues.
