-- Runs once when the docker MySQL volume is first created (see docker-compose.yml).
-- pd_shadow: scratch database for `prisma migrate dev`; pd_test: automated tests (wiped on every run).
CREATE DATABASE IF NOT EXISTS pd_shadow;
CREATE DATABASE IF NOT EXISTS pd_test;
