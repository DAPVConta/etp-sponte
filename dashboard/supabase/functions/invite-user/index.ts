// Edge Function: invite-user
// Usa service_role para criar/convidar usuario no Supabase Auth
// e vincular na tabela etp_user_empresas.
//
// Deploy: supabase functions deploy invite-user
// Requer variavel de ambiente: SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Valida que quem chamou e super_admin ou admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Nao autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cliente com service_role para operacoes privilegiadas
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Cliente com JWT do chamador para validar permissao
    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verifica se caller e super_admin ou admin da empresa
    const { data: { user: caller } } = await supabaseCaller.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Nao autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, empresaId, role } = await req.json();

    if (!email || !empresaId || !role) {
      return new Response(JSON.stringify({ error: 'email, empresaId e role sao obrigatorios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Valida role
    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Role invalido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verifica permissao do chamador
    const isSuperAdmin = caller.user_metadata?.role === 'super_admin';
    if (!isSuperAdmin) {
      const { data: vinculo } = await supabaseAdmin
        .from('etp_user_empresas')
        .select('role')
        .eq('user_id', caller.id)
        .eq('empresa_id', empresaId)
        .maybeSingle();
      if (!vinculo || vinculo.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Apenas super_admin ou admin da empresa pode convidar usuarios' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Convida usuario (cria ou reenvia email)
    const { data, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${Deno.env.get('SITE_URL') ?? ''}/login`,
    });
    if (inviteError) throw inviteError;

    // Vincula na tabela etp_user_empresas
    const { error: vincularError } = await supabaseAdmin
      .from('etp_user_empresas')
      .upsert({ user_id: data.user.id, empresa_id: empresaId, role }, { onConflict: 'user_id,empresa_id' });
    if (vincularError) throw vincularError;

    return new Response(JSON.stringify({ ok: true, userId: data.user.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const e = err as { message?: string };
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
