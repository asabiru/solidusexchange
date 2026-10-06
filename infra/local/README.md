# Локальный dev-стенд (infra/local)

**Только для разработки.** Это не production-развёртывание и не шаблон для него.
Все данные синтетические, реальных провайдеров, денег, ключей и персональных
данных здесь нет. Деплой, облако и публикация образов в реестры не
предусмотрены.

## Что запускается

| Сервис | Что это | Порт на хосте |
| --- | --- | --- |
| `customer-api` | `packages/customer-api`, режим `CUSTOMER_API_DEV_AUTH=synthetic` | `127.0.0.1:4185` |
| `miniapp-bff` + `miniapp-web` | BFF Mini App (dev-login, provider-simulators) и собранная статика через `vite preview` | `127.0.0.1:4183` |
| `backoffice-bff` + `backoffice-web` | BFF бэкофиса (`BACKOFFICE_MODE=dev-dry-run`) и собранная статика | `127.0.0.1:4173` |
| `backoffice-audit-db` | PostgreSQL 16 для append-only журнала аудита бэкофиса (миграция `backoffice/migrations/0001_append_only_audit.sql`) | не публикуется |
| `dev-material` | одноразовый контейнер: генерирует синтетические ключи и TLS при старте | — |
| `miniapp-edge`, `backoffice-edge` | маленький TCP-edge (см. ниже) | — |

Финансовых действий нет: заявки, расчёты, выплаты, подписи и запись в леджер
отсутствуют; всё остаётся preview-only. Ответы симуляторов провайдеров —
только синтетические доказательства.

## Запуск

Нужны Docker и Docker Compose v2. Из корня репозитория:

```sh
docker compose -f infra/local/compose.yaml up --build --wait
```

Проверка:

```sh
curl http://127.0.0.1:4183/bff/health
curl http://127.0.0.1:4173/bff/healthz
```

Mini App: <http://127.0.0.1:4183>, бэкофис: <http://127.0.0.1:4173>
(вход через синтетический dev-login). Остановка с удалением томов:

```sh
docker compose -f infra/local/compose.yaml down -v
```

## Почему edge, а не 0.0.0.0

Серверы специально слушают только loopback и отказываются от других адресов;
эти проверки не ослаблены. Поэтому приложения запускаются в сетевом
пространстве edge-контейнера (`network_mode: service:<edge>`) и слушают
`127.0.0.1` внутри него. Edge — единственный процесс, слушающий интерфейс
контейнера: он принимает соединения только с loopback и от шлюза Docker-сети
(то есть от `docker-proxy` хоста) и пересылает их на `127.0.0.1`. Docker
публикует порты только на `127.0.0.1` хоста. Сеть Mini App и сеть бэкофиса
разделены; PostgreSQL слушает только `127.0.0.1` внутри сетевого пространства
бэкофиса и наружу не публикуется.

## Ключи и `.env`

В образы и в репозиторий секреты не попадают. Контейнер `dev-material` при
каждом запуске создаёт в томе `dev-material`:

- ключ синтетических dev-токенов customer-api (общий для customer-api и BFF Mini App);
- пароли ролей аудит-БД (сохраняются между перезапусками, пока жив том);
- одноразовый dev-CA и сертификат сервера PostgreSQL на 30 дней, чтобы BFF
  подключался по TLS с проверкой сертификата.

Значения можно задать в `infra/local/.env` (в `.gitignore`); шаблон —
`.env.example`, все секретные поля в нём пустые. Не кладите туда реальные
ключи.

Все контейнеры работают не от root, с read-only файловой системой,
`cap_drop: ALL` и `no-new-privileges`. `NODE_ENV` всегда `development`.

## Проверка в CI

`.github/scripts/check-dev-stack.mjs` статически проверяет этот каталог:
порты только на `127.0.0.1`, `NODE_ENV` нигде не равен production, все образы закреплены
по digest, нет похожих на секреты литералов, ни один контейнер не работает от
root. Workflow `local-dev-stack-ci.yml` запускает чекер, его тесты и тесты
вспомогательных скриптов.

## English summary

Dev-only local stack: customer-api, Mini App BFF + static build, backoffice
BFF + static build and a PostgreSQL audit store, all with synthetic data and
no real providers, money movement or credentials. **Not a production
deployment.** Run `docker compose -f infra/local/compose.yaml up --build
--wait` from the repository root; ports are published on `127.0.0.1` only
(4183 Mini App, 4173 backoffice, 4185 customer-api). Apps keep their
loopback-only binds and share the network namespace of a small TCP edge that
forwards host-loopback traffic to `127.0.0.1`. Synthetic keys and a short-lived
dev CA are generated at start-up, or taken from a gitignored
`infra/local/.env` (see `.env.example`). `.github/scripts/check-dev-stack.mjs`
enforces the loopback, digest-pinning, non-root, no-secret and
never-production `NODE_ENV` rules in CI.
