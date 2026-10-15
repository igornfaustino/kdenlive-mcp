# Instruções para agentes

## Escopo e fonte de verdade

Este repositório implementa uma biblioteca TypeScript e um servidor MCP local
para editar arquivos `.kdenlive` já salvos. Trabalhe sobre o código e os testes
atuais; propostas em documentos de design não são funcionalidades entregues.
Consulte [docs/STATUS.md](docs/STATUS.md) antes de continuar a implementação.
O produto ainda não cobre todo o MVP proposto.

O servidor não controla o editor aberto nem lê mudanças não salvas. Os processos
MLT/ffprobe aparecem em scripts de aceitação, não em ferramentas de renderização
MCP. Não apresente uma renderização como prova de abertura e gravação pelo editor.

Instruções explícitas do usuário prevalecem sobre templates das skills. Preserve
alterações preexistentes; não inclua trabalho alheio ou incompleto no seu commit.
Em tarefas apenas documentais, registre bugs e pendências sem alterar código.

## Ambiente e comandos

- `package.json`: ESM, Node.js `>=22`, pnpm `11.17.0`; CI usa Node.js 24.
- Dependências de execução: MCP SDK, Zod e saxes. TypeScript e Vitest são de
  desenvolvimento; consulte o lockfile para versões resolvidas.
- Use pnpm e preserve `pnpm-lock.yaml`. Não introduza Bun, frontend ou bindings
  nativos apenas porque uma skill oferece exemplos com essas tecnologias.
- Neste ambiente do proprietário, siga `@/Users/igornfaustino/.codex/RTK.md`:
  prefixe comandos de shell com `rtk`; use `rtk proxy` quando precisar da saída
  integral. Esse arquivo externo não acompanha o clone.

```sh
rtk proxy pnpm install --frozen-lockfile
rtk proxy pnpm typecheck
rtk proxy pnpm test
rtk proxy pnpm build
rtk proxy pnpm check
rtk proxy pnpm test:stdio
rtk proxy pnpm start --root /caminho/absoluto/projetos
```

`check` executa typecheck, testes e build nessa ordem, interrompendo no primeiro
erro. Não diga que o build passou só porque a checagem de tipos passou. Para uma
suíte específica, prefira `rtk proxy pnpm exec vitest run tests/import.test.ts`;
confira a saída, pois encaminhar argumentos pelo script `test` pode executar
mais suítes. Não há script de lint, formatter configurado ou meta de cobertura.
O estilo dos arquivos atuais não implica uma configuração de Prettier instalada.

## Arquitetura real

| Caminho | Responsabilidade |
| --- | --- |
| `src/cli.ts` | Lê `--root` repetido, cria Workspace e conecta MCP por stdio |
| `src/index.ts` | Exportações públicas: Project, Workspace, ProjectError, toFrames e tipos de frames/operações |
| `src/core/xml.ts` | Parsing saxes, índices de IDs e spans, escape e patches de XML |
| `src/core/model.ts` | Projeção de sequência, tracks, playlists, clips e durações |
| `src/core/time.ts` | Validação de frames e conversão de relógios com FPS racional |
| `src/core/project.ts` | XML em memória, revisão, inspeção e entrada transacional das mutações |
| `src/core/editing.ts` | União tipada de operações, verificações de layout, batch e duração |
| `src/core/audio.ts` | Pilhas gerenciadas de volume/fades e reconhecimento conservador |
| `src/core/music.ts` | Inserção/substituição de áudio já no bin, sem deslocamento na inserção |
| `src/core/import-audio.ts` | Adiciona chain/entry ao bin a partir de metadados recebidos |
| `src/core/errors.ts` | ProjectError e requireCondition |
| `src/io/workspace.ts` | Raízes, sessões, arquivos, revisão/busy, validação de mídia e Save As |
| `src/io/wave.ts` | Inspeção limitada de cabeçalhos RIFF/WAV em arquivo local |
| `src/mcp/server.ts` | Schemas Zod, sete ferramentas e adaptação de resultados/erros |
| `scripts/` | Aceitação stdio e renderizações de fixtures sintéticas confiáveis |
| `tests/fixtures/` | Projetos nativos e tom sintético com proveniência documentada |

Mantenha o core independente de filesystem, processos e MCP. O Workspace resolve
arquivos e fornece fatos ao core. A camada MCP deve permanecer fina, sem duplicar
regras de edição. Esta separação já existe; não pressupõe um framework DDD,
banco de dados, servidor HTTP ou infraestrutura de jobs.

## Decisões e invariantes

1. **Preservação por spans.** O XML original é a fonte de verdade. A projeção em
   `model.ts` não é um serializador completo. Edite spans localizados com os
   helpers existentes; não regenere todo o documento a partir da projeção.
   Preserve XML não afetado e teste explicitamente seus bytes. Recuse estruturas
   desconhecidas quando a operação descartaria ou reinterpretaria conteúdo.
2. **Frames.** Tempos de operações são inteiros seguros não negativos e ranges
   são `[start,end)`. O `out` de MLT é inclusivo: serialize `sourceOut - 1`.
   Split usa offset relativo ao clipe. FPS é uma razão; use BigInt para conversão
   sem acumular erro. Importação WAV usa piso e recusa menos de um frame completo.
3. **Revisões.** Alterações exigem `expectedRevision`. Handles de clipe são
   `playlistId:índiceDeEntry`, válidos na revisão inspecionada; não são IDs
   imutáveis do editor. Um batch usa string candidata, valida cada resultado e
   só então altera o Project. Há no máximo uma operação por track por batch.
4. **Limites de layout.** Edição de timeline exige versão documental `1.1`, uma
   sequência, duas playlists por track e no máximo uma com segmentos. Recusa
   grupos, mixes, tracks bloqueadas, referências temporais não modeladas,
   transições de usuário e efeitos não aceitos. `internal_added=237` identifica
   efeitos/transições internos aceitos pelo código atual; não amplie essa regra
   sem fixtures e validação nativa. Importação no bin tem suas próprias checagens
   em `import-audio.ts`; não alegue que usa todas as checagens da timeline.
5. **Áudio local ao clipe.** Filtros de volume/fades ficam no `<entry>`, não no
   produtor compartilhado. Use `kdenlive_id` e o marcador `kdenlive-mcp:audio`.
   Só substitua pilhas reconhecidas integralmente; dados nativos desconhecidos
   devem causar recusa. Ganho: -60 a +20 dB; fade: zero ou pelo menos dois frames,
   com soma limitada à duração. Cortes temporais ainda recusam efeitos afetados.
6. **Referências de música.** Inserção preenche espaço vazio ou anexa com blank;
   recusa sobreposição. Substituição preserva posição/duração e exige alvo sem
   efeitos/links. Clone a fonte do bin com ID XML único antes da playlist alvo,
   pois MLT resolve referências durante a leitura. Preserve a identidade do bin
   e a definição original. Não confunda ID XML com `kdenlive:id`.
7. **Importação.** Workspace valida o caminho antes de inspecionar WAV. A operação
   adiciona uma referência absoluta, não copia nem converte o arquivo. O core
   recebe metadados; a inspeção real pertence a `wave.ts`. O suporte atual é
   PCM16 mono/estéreo clássico e possui um bug conhecido de FourCC (ver STATUS).
8. **Persistência.** Use raízes canônicas e verificação de symlinks. Preserve a
   verificação de hash do projeto original e o bloqueio busy em operações
   assíncronas. Save As só publica um novo `.kdenlive` na mesma pasta do original:
   temporário exclusivo, sync e hard link sem sobrescrita. Valide a mídia antes
   de publicar. Mídia relativa exige XML root absoluto. Nunca execute comandos
   contidos em XML. A proteção não é um sandbox contra corridas locais hostis,
   nem garante sync do diretório após queda de energia. Falha de limpeza pode
   ocorrer depois da publicação: confira o destino antes de repetir.

## Convenções de código e testes

- TypeScript estrito, NodeNext, imports relativos com extensão `.js`, saída em
  `dist/` com declarações. Preserve `noUncheckedIndexedAccess`, `noUnusedLocals`
  e `noUnusedParameters`; não enfraqueça o compilador para acomodar uma mudança.
- Tipos discriminados para operações e handlers tipados. Erros de domínio usam
  códigos estáveis em ProjectError; o MCP retorna `isError` e `{code,message}`.
- Em execução do servidor, stdout é reservado ao transporte MCP; diagnósticos vão
  para stderr. O ramo `--help` imprime uso e encerra sem iniciar o transporte.
- Antes de mudar comportamento, reproduza o problema ou requisito com um teste.
  Use fixtures sintéticas e diretórios temporários com limpeza. Não use projetos
  pessoais como fixture nem normalize grandes trechos de XML sem necessidade.
- Verifique preservação, rollback, fronteiras inclusivas/exclusivas, IDs únicos,
  revisões obsoletas e caminhos conforme a área afetada. Testes não substituem
  aceitação no editor para novas estruturas Kdenlive.
- Rode os checks pertinentes e registre falhas preexistentes. Não apague testes
  vermelhos nem declare o repositório verde ocultando a suíte que falhou.
- Faça commits pequenos e frequentes por etapa verificável, conforme pedido do
  proprietário. Inspecione status/diff antes de adicionar arquivos; faça stage
  explícito. Não publique, faça push ou crie release por inferência.

## Aceitação nativa e evidência

`test:native` usa melt e ffprobe para contar frames; `test:audio` mede RMS;
`test:music` mede componentes de 440/880 Hz. Os scripts escrevem em `.artifacts/`,
ignorado pelo Git. `MELT_PATH` substitui o executável padrão; `FFPROBE_PATH` vale
para o script de vídeo. No macOS, melt padrão fica em
`/Applications/kdenlive.app/Contents/MacOS/melt`; nos demais sistemas, é `melt`.

Reabrir e salvar pelo Kdenlive é uma verificação separada e manual. Os scripts de
áudio/música aceitam caminhos de cópias salvas nativamente para medições extras.
Há evidência local de um frame extra no wrapper após Save As dessa fixture,
inclusive no controle sem edição. Não generalize isso para outros projetos nem
altere durações para esconder a diferença. Consulte `docs/verification.md` e
`docs/STATUS.md` para limites e proveniência.

CI está configurado para Ubuntu/macOS, Node.js 24, check e stdio. A existência do
workflow não comprova que rodou remotamente. Não versionar node_modules, dist,
.artifacts, coverage, `.DS_Store` ou backups `*.kdenlive~`.

## Skills e documentação externa

As dez skills em `.agents/skills/` são cópias locais da coleção preferida do
proprietário; consulte seu README e aplique apenas as pertinentes. Templates
não comprovam testes executados nem autorizam funcionalidades. Código/docs do
projeto têm licença MIT; as skills mantêm os próprios termos.

Para questões de biblioteca, framework, SDK, API, CLI ou serviço, use Context7
conforme as instruções do proprietário, inclusive sintaxe, configuração,
migração e depuração específica da biblioteca:

1. `npx ctx7@latest library <nome oficial> "<pergunta específica>"`.
2. Escolha o ID `/org/project` por correspondência, relevância e reputação.
3. `npx ctx7@latest docs <id> "<pergunta específica>"`.

Prefixe esses comandos com `rtk proxy` neste ambiente. Resolva a biblioteca antes
de consultar docs, salvo ID fornecido diretamente. Limite a três comandos por
pergunta, uma questão conceitual por consulta, sem credenciais. Use ID de versão
quando disponível. Não é necessário para revisão de código, refatoração, lógica
de negócio ou scripts escritos do zero. Em erro de quota, informe o usuário e
sugira login ou CONTEXT7_API_KEY; não substitua silenciosamente por memória.
Em falha de rede, siga as permissões do ambiente para execução fora do sandbox;
não solicite uma modalidade de execução proibida pelo ambiente atual.
