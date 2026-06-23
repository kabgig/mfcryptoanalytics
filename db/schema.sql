\restrict dbmate

-- Dumped from database version 17.10 (21f7c76)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'ADMIN',
    'USER'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cached_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cached_trades (
    id text NOT NULL,
    telegram_id bigint NOT NULL,
    exchange text NOT NULL,
    ticker text NOT NULL,
    position_size numeric DEFAULT 0 NOT NULL,
    tp numeric,
    sl numeric,
    open_time timestamp with time zone NOT NULL,
    close_time timestamp with time zone NOT NULL,
    pnl numeric DEFAULT 0 NOT NULL,
    market text,
    side character varying(5)
);


--
-- Name: exchange_fetch_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_fetch_log (
    telegram_id bigint NOT NULL,
    exchange text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    telegram_id bigint NOT NULL,
    telegram_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role public.user_role DEFAULT 'USER'::public.user_role NOT NULL,
    share_token text
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: cached_trades cached_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_trades
    ADD CONSTRAINT cached_trades_pkey PRIMARY KEY (telegram_id, exchange, id);


--
-- Name: exchange_fetch_log exchange_fetch_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_fetch_log
    ADD CONSTRAINT exchange_fetch_log_pkey PRIMARY KEY (telegram_id, exchange);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_share_token_key UNIQUE (share_token);


--
-- Name: users users_telegram_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_telegram_id_key UNIQUE (telegram_id);


--
-- Name: cached_trades_telegram_close_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cached_trades_telegram_close_time ON public.cached_trades USING btree (telegram_id, close_time DESC);


--
-- Name: users_share_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_share_token_idx ON public.users USING btree (share_token) WHERE (share_token IS NOT NULL);


--
-- Name: cached_trades cached_trades_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_trades
    ADD CONSTRAINT cached_trades_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;


--
-- Name: exchange_fetch_log exchange_fetch_log_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_fetch_log
    ADD CONSTRAINT exchange_fetch_log_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260425033539'),
    ('20260425120000'),
    ('20260426000001'),
    ('20260426000002'),
    ('20260430000001'),
    ('20260505000001'),
    ('20260623000001');
