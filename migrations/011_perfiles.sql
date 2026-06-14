CREATE TABLE public.perfiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL UNIQUE REFERENCES public.usuarios(id),
    logo_ascii TEXT NOT NULL,
    carta TEXT CHECK (char_length(carta) <= 280),
    estatus BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_por TEXT NOT NULL DEFAULT 'sistema',
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por TEXT NOT NULL DEFAULT 'sistema'
);

CREATE TRIGGER trg_perfiles_actualizado
    BEFORE UPDATE ON public.perfiles
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();
