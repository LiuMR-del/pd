-- First-run setup for the Windows local MySQL (tools/env/mysql.cmd).
-- Mirrors docker-compose.yml: same databases, users and passwords as apps/server/.env.example.
CREATE DATABASE IF NOT EXISTS pd;
CREATE DATABASE IF NOT EXISTS pd_shadow;
CREATE DATABASE IF NOT EXISTS pd_test;
CREATE USER IF NOT EXISTS 'pd'@'%' IDENTIFIED BY 'pd_dev';
GRANT ALL ON pd.* TO 'pd'@'%';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'pd_root_dev';
GRANT ALL ON *.* TO 'root'@'%' WITH GRANT OPTION;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'pd_root_dev';
