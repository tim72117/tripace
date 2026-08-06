--
-- PostgreSQL database dump
--

\restrict py1n6KxZ0uBX7eMidqEMNpRmqogHFLqYY5tgJRaAJnKsPHs3ow5FOnIry7XEysg

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: photo_cache; Type: TABLE; Schema: public; Owner: tripace
--

CREATE TABLE public.photo_cache (
    photo_ref text NOT NULL,
    max_width_px bigint NOT NULL,
    data_uri text NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    place_id text
);


ALTER TABLE public.photo_cache OWNER TO tripace;

--
-- Data for Name: photo_cache; Type: TABLE DATA; Schema: public; Owner: tripace
--

COPY public.photo_cache (photo_ref, max_width_px, data_uri, fetched_at, place_id) FROM stdin;
\.


--
-- Name: photo_cache photo_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: tripace
--

ALTER TABLE ONLY public.photo_cache
    ADD CONSTRAINT photo_cache_pkey PRIMARY KEY (photo_ref, max_width_px);


--
-- PostgreSQL database dump complete
--

\unrestrict py1n6KxZ0uBX7eMidqEMNpRmqogHFLqYY5tgJRaAJnKsPHs3ow5FOnIry7XEysg

