\restrict dbmate

-- Dumped from database version 17.11 (32e7196)
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
    side character varying(5),
    deleted_at timestamp with time zone
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
-- Name: spot_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spot_entries (
    id bigint NOT NULL,
    telegram_id bigint NOT NULL,
    ticker text NOT NULL,
    side character varying(4) DEFAULT 'BUY'::character varying NOT NULL,
    qty numeric NOT NULL,
    price numeric NOT NULL,
    traded_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT spot_entries_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT spot_entries_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT spot_entries_side_chk CHECK (((side)::text = ANY ((ARRAY['BUY'::character varying, 'SELL'::character varying])::text[])))
);


--
-- Name: spot_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spot_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spot_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spot_entries_id_seq OWNED BY public.spot_entries.id;


--
-- Name: spot_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spot_price_history (
    ticker text NOT NULL,
    day date NOT NULL,
    close double precision NOT NULL
);


--
-- Name: trade_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_notes (
    telegram_id bigint NOT NULL,
    exchange text NOT NULL,
    trade_id text NOT NULL,
    phase text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trade_notes_body_chk CHECK ((length(btrim(body)) > 0)),
    CONSTRAINT trade_notes_phase_chk CHECK ((phase = ANY (ARRAY['before'::text, 'during'::text, 'after'::text])))
);


--
-- Name: trade_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_overrides (
    telegram_id bigint NOT NULL,
    exchange text NOT NULL,
    trade_id text NOT NULL,
    tp1 numeric,
    sl numeric,
    bias text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tp2 numeric,
    entry numeric,
    risk_pct numeric,
    rr numeric,
    rules_ok boolean,
    strategy text,
    timeframe text,
    killzone text,
    exit_reason text,
    mistake text,
    emotion text,
    CONSTRAINT trade_overrides_bias_chk CHECK (((bias IS NULL) OR (bias = ANY (ARRAY['buy'::text, 'sell'::text])))),
    CONSTRAINT trade_overrides_empty_chk CHECK (((tp1 IS NOT NULL) OR (tp2 IS NOT NULL) OR (sl IS NOT NULL) OR (entry IS NOT NULL) OR (bias IS NOT NULL) OR (risk_pct IS NOT NULL) OR (rr IS NOT NULL) OR (rules_ok IS NOT NULL) OR (strategy IS NOT NULL) OR (timeframe IS NOT NULL) OR (killzone IS NOT NULL) OR (exit_reason IS NOT NULL) OR (mistake IS NOT NULL) OR (emotion IS NOT NULL))),
    CONSTRAINT trade_overrides_killzone_chk CHECK (((killzone IS NULL) OR (killzone = ANY (ARRAY['asia'::text, 'london'::text, 'nyam'::text, 'nypm'::text, 'outside'::text])))),
    CONSTRAINT trade_overrides_numeric_chk CHECK ((((entry IS NULL) OR (entry >= (0)::numeric)) AND ((tp1 IS NULL) OR (tp1 >= (0)::numeric)) AND ((tp2 IS NULL) OR (tp2 >= (0)::numeric)) AND ((sl IS NULL) OR (sl >= (0)::numeric)) AND ((rr IS NULL) OR (rr >= (0)::numeric)) AND ((risk_pct IS NULL) OR ((risk_pct >= (0)::numeric) AND (risk_pct <= (100)::numeric))))),
    CONSTRAINT trade_overrides_strategy_chk CHECK (((strategy IS NULL) OR (strategy = ANY (ARRAY['orderflow'::text, 'pa'::text, 'macro'::text])))),
    CONSTRAINT trade_overrides_timeframe_chk CHECK (((timeframe IS NULL) OR (timeframe = ANY (ARRAY['5m'::text, '15m'::text, '1h'::text]))))
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
-- Name: spot_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_entries ALTER COLUMN id SET DEFAULT nextval('public.spot_entries_id_seq'::regclass);


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
-- Name: spot_entries spot_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_entries
    ADD CONSTRAINT spot_entries_pkey PRIMARY KEY (id);


--
-- Name: spot_price_history spot_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_price_history
    ADD CONSTRAINT spot_price_history_pkey PRIMARY KEY (ticker, day);


--
-- Name: trade_notes trade_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_notes
    ADD CONSTRAINT trade_notes_pkey PRIMARY KEY (telegram_id, exchange, trade_id, phase);


--
-- Name: trade_overrides trade_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_overrides
    ADD CONSTRAINT trade_overrides_pkey PRIMARY KEY (telegram_id, exchange, trade_id);


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
-- Name: cached_trades_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cached_trades_deleted ON public.cached_trades USING btree (telegram_id, exchange) WHERE (deleted_at IS NOT NULL);


--
-- Name: cached_trades_telegram_close_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cached_trades_telegram_close_time ON public.cached_trades USING btree (telegram_id, close_time DESC);


--
-- Name: spot_entries_user_ticker_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spot_entries_user_ticker_time ON public.spot_entries USING btree (telegram_id, ticker, traded_at) WHERE (deleted_at IS NULL);


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
-- Name: spot_entries spot_entries_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_entries
    ADD CONSTRAINT spot_entries_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;


--
-- Name: trade_notes trade_notes_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_notes
    ADD CONSTRAINT trade_notes_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;


--
-- Name: trade_overrides trade_overrides_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_overrides
    ADD CONSTRAINT trade_overrides_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;


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
    ('20260623000001'),
    ('20260708120000'),
    ('20260813000001'),
    ('20260813000002'),
    ('20260814000001'),
    ('20260814000002'),
    ('20260815000001'),
    ('20260826000001'),
    ('20260828000001'),
    ('20260902000001');
