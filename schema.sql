-- =============================================================
--  SISTEMA DE GESTIÓN DE JUICIOS EVALUATIVOS — SENA
--  Script de creación de base de datos
--  Motor: PostgreSQL 12+ | UTF-8
-- =============================================================

-- NOTA: En PostgreSQL, primero crea la base de datos si aún no existe:
-- CREATE DATABASE juicios_evaluativos;
-- Y luego conéctate a ella antes de ejecutar las siguientes instrucciones.

-- -------------------------------------------------------------
--  1. FUNCIONARIO
--     Instructores que registran los juicios evaluativos.
--     Se extrae del campo "CC 1117523028 - NOMBRE APELLIDO".
--     El funcionario vacío llega como "  -   " en el Excel;
--     el importador lo descarta y no inserta ningún registro.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funcionario (
  id_funcionario    SERIAL PRIMARY KEY,
  tipo_documento    VARCHAR(5)       NOT NULL,
  numero_documento  VARCHAR(20)      NOT NULL,
  nombre_completo   VARCHAR(120)     NOT NULL,
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_funcionario_doc UNIQUE (tipo_documento, numero_documento)
);

COMMENT ON TABLE funcionario IS 'Instructores / funcionarios que registran juicios evaluativos';


-- -------------------------------------------------------------
--  2. FICHA
--     Cada archivo Excel cargado corresponde a una ficha de
--     caracterización. El numero_ficha es el identificador
--     natural (ej: 3142784).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ficha (
  id_ficha          SERIAL PRIMARY KEY,
  numero_ficha      VARCHAR(20)      NOT NULL,
  codigo_programa   VARCHAR(20)      NOT NULL,
  version           SMALLINT         NOT NULL DEFAULT 1,
  denominacion      VARCHAR(255)     NOT NULL,
  estado_ficha      VARCHAR(30)      NOT NULL DEFAULT 'EN EJECUCION',
  fecha_inicio      DATE             NULL,
  fecha_fin         DATE             NULL,
  modalidad         VARCHAR(30)      NOT NULL DEFAULT 'PRESENCIAL',
  regional          VARCHAR(80)      NOT NULL,
  centro_formacion  VARCHAR(120)     NOT NULL,
  ultima_importacion TIMESTAMP       NULL,
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_ficha_numero UNIQUE (numero_ficha)
);

COMMENT ON TABLE ficha IS 'Fichas de caracterización — una por cada Excel importado';


-- -------------------------------------------------------------
--  3. APRENDIZ
--     Un aprendiz pertenece a una ficha. El numero_documento
--     es único a nivel global (regla de negocio).
--     Estados posibles según el reporte real de Sofia Plus:
--       EN FORMACION | RETIRO VOLUNTARIO | TRASLADADO | DESERTADO
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aprendiz (
  id_aprendiz       SERIAL PRIMARY KEY,
  id_ficha          INTEGER          NOT NULL,
  tipo_documento    VARCHAR(5)       NOT NULL,
  numero_documento  VARCHAR(20)      NOT NULL,
  nombres           VARCHAR(80)      NOT NULL,
  apellidos         VARCHAR(80)      NOT NULL,
  estado            VARCHAR(30)      NOT NULL DEFAULT 'EN FORMACION'
                    CHECK (estado IN ('EN FORMACION', 'RETIRO VOLUNTARIO', 'TRASLADADO', 'DESERTADO')),
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_aprendiz_doc UNIQUE (numero_documento),
  CONSTRAINT fk_aprendiz_ficha
    FOREIGN KEY (id_ficha) REFERENCES ficha (id_ficha)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_aprendiz_ficha  ON aprendiz (id_ficha);
CREATE INDEX IF NOT EXISTS idx_aprendiz_estado ON aprendiz (estado);

COMMENT ON TABLE aprendiz IS 'Aprendices inscritos en una ficha de caracterización';


-- -------------------------------------------------------------
--  4. COMPETENCIA
--     Catálogo de competencias. El codigo_competencia es el
--     identificador natural del SENA (ej: 36180).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competencia (
  id_competencia     SERIAL PRIMARY KEY,
  codigo_competencia VARCHAR(20)     NOT NULL,
  descripcion        TEXT            NOT NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_competencia_codigo UNIQUE (codigo_competencia)
);

COMMENT ON TABLE competencia IS 'Catálogo de competencias del programa de formación';


-- -------------------------------------------------------------
--  5. RESULTADO_APRENDIZAJE
--     Cada RA pertenece a una competencia. El codigo_resultado
--     es el identificador natural del SENA (ej: 593147).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultado_aprendizaje (
  id_resultado       SERIAL PRIMARY KEY,
  id_competencia     INTEGER         NOT NULL,
  codigo_resultado   VARCHAR(20)     NOT NULL,
  descripcion        TEXT            NOT NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_resultado_codigo UNIQUE (codigo_resultado),
  CONSTRAINT fk_resultado_competencia
    FOREIGN KEY (id_competencia) REFERENCES competencia (id_competencia)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resultado_competencia ON resultado_aprendizaje (id_competencia);

COMMENT ON TABLE resultado_aprendizaje IS 'Resultados de aprendizaje agrupados por competencia';


-- -------------------------------------------------------------
--  6. JUICIO_EVALUATIVO
--     Tabla de hechos. Registra el juicio de cada aprendiz
--     sobre cada resultado de aprendizaje dentro de una ficha.
--
--     Valores de juicio según el Excel real de Sofia Plus:
--       APROBADO | NO APROBADO | POR EVALUAR
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS juicio_evaluativo (
  id_juicio          SERIAL PRIMARY KEY,
  id_aprendiz        INTEGER         NOT NULL,
  id_resultado       INTEGER         NOT NULL,
  id_funcionario     INTEGER         NULL,
  id_ficha           INTEGER         NOT NULL,
  juicio             VARCHAR(20)     NOT NULL DEFAULT 'POR EVALUAR'
                     CHECK (juicio IN ('APROBADO', 'NO APROBADO', 'POR EVALUAR')),
  fecha_hora_juicio  TIMESTAMP       NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_juicio_aprendiz_resultado_ficha UNIQUE (id_aprendiz, id_resultado, id_ficha),

  CONSTRAINT fk_juicio_aprendiz
    FOREIGN KEY (id_aprendiz) REFERENCES aprendiz (id_aprendiz)
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT fk_juicio_resultado
    FOREIGN KEY (id_resultado) REFERENCES resultado_aprendizaje (id_resultado)
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT fk_juicio_funcionario
    FOREIGN KEY (id_funcionario) REFERENCES funcionario (id_funcionario)
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT fk_juicio_ficha
    FOREIGN KEY (id_ficha) REFERENCES ficha (id_ficha)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_juicio_aprendiz    ON juicio_evaluativo (id_aprendiz);
CREATE INDEX IF NOT EXISTS idx_juicio_resultado   ON juicio_evaluativo (id_resultado);
CREATE INDEX IF NOT EXISTS idx_juicio_funcionario ON juicio_evaluativo (id_funcionario);
CREATE INDEX IF NOT EXISTS idx_juicio_ficha       ON juicio_evaluativo (id_ficha);
CREATE INDEX IF NOT EXISTS idx_juicio_valor       ON juicio_evaluativo (juicio);

COMMENT ON TABLE juicio_evaluativo IS 'Juicios evaluativos por aprendiz, resultado y ficha';


-- =============================================================
--  VISTAS
-- =============================================================

-- Vista: avance por aprendiz en una ficha
CREATE OR REPLACE VIEW v_avance_aprendiz AS
SELECT
  a.id_aprendiz,
  a.id_ficha,
  a.tipo_documento,
  a.numero_documento,
  CONCAT(a.nombres, ' ', a.apellidos)                          AS nombre_completo,
  a.estado,
  COUNT(j.id_juicio)                                           AS total_juicios,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')       AS aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')    AS no_aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')    AS por_evaluar,
  ROUND(
    100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO') / NULLIF(COUNT(j.id_juicio), 0),
    1
  )                                                            AS pct_avance
FROM aprendiz a
LEFT JOIN juicio_evaluativo j ON j.id_aprendiz = a.id_aprendiz
GROUP BY
  a.id_aprendiz, a.id_ficha, a.tipo_documento,
  a.numero_documento, a.nombres, a.apellidos, a.estado;


-- Vista: aprobación por competencia en una ficha
CREATE OR REPLACE VIEW v_aprobacion_competencia AS
SELECT
  j.id_ficha,
  c.id_competencia,
  c.codigo_competencia,
  c.descripcion                                                AS competencia,
  COUNT(j.id_juicio)                                           AS total_juicios,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')       AS aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')    AS no_aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')    AS por_evaluar,
  ROUND(
    100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO') / NULLIF(COUNT(j.id_juicio), 0),
    1
  )                                                            AS pct_aprobacion
FROM juicio_evaluativo j
JOIN resultado_aprendizaje ra ON ra.id_resultado  = j.id_resultado
JOIN competencia           c  ON c.id_competencia = ra.id_competencia
GROUP BY j.id_ficha, c.id_competencia, c.codigo_competencia, c.descripcion;


-- Vista: resumen general de una ficha
CREATE OR REPLACE VIEW v_resumen_ficha AS
SELECT
  f.id_ficha,
  f.numero_ficha,
  f.denominacion,
  f.ultima_importacion,
  COUNT(DISTINCT a.id_aprendiz)                                        AS total_aprendices,
  COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'EN FORMACION')       AS en_formacion,
  COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'RETIRO VOLUNTARIO')  AS retirados,
  COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'TRASLADADO')         AS trasladados,
  COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'DESERTADO')          AS desertados,
  COUNT(j.id_juicio)                                                   AS total_juicios,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')              AS aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')           AS no_aprobados,
  COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')           AS por_evaluar,
  ROUND(
    100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO') / NULLIF(COUNT(j.id_juicio), 0),
    1
  )                                                                    AS pct_avance_global
FROM ficha f
LEFT JOIN aprendiz          a ON a.id_ficha    = f.id_ficha
LEFT JOIN juicio_evaluativo j ON j.id_aprendiz = a.id_aprendiz
GROUP BY f.id_ficha, f.numero_ficha, f.denominacion, f.ultima_importacion;
