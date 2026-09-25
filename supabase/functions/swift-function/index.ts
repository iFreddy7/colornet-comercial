import { createClient } from "npm:@supabase/supabase-js@2.116.0";

Deno.serve(async (req) => {
  try {
    const apikey = req.headers.get("apikey") ?? "";
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!secretKeysRaw) {
      return Response.json({ erro: "SUPABASE_SECRET_KEYS não disponível na Edge Function." }, { status: 500 });
    }

    const secretKeys = JSON.parse(secretKeysRaw);
    const secretasValidas = Object.values(secretKeys);

    if (!apikey || !secretasValidas.includes(apikey)) {
      return Response.json({ erro: "Não autorizado." }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKey = secretKeys["default"] ?? Object.values(secretKeys)[0];
    const supabase = createClient(supabaseUrl, secretKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: vendedores, error: erroVendedores } = await supabase
      .from("vendedores")
      .select(`id,codigo_protheus,nome,email,ativo`)
      .eq("ativo", true)
      .not("email", "is", null)
      .order("nome");

    if (erroVendedores) throw erroVendedores;
    if (!vendedores?.length) return Response.json({ mensagem: "Nenhum vendedor ativo com e-mail encontrado." });

    const { data: authData, error: erroAuth } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (erroAuth) throw erroAuth;

    const usuariosExistentes = new Map(
      authData.users.filter((u) => u.email).map((u) => [u.email!.trim().toLowerCase(), u])
    );

    const resultado = {
      vendedoresEncontrados: vendedores.length,
      criados: [] as any[],
      jaExistiam: [] as any[],
      semEmail: [] as any[],
      erros: [] as any[],
    };

    for (const vendedor of vendedores) {
      const email = vendedor.email?.trim().toLowerCase();
      if (!email) {
        resultado.semEmail.push({ vendedor: vendedor.nome });
        continue;
      }

      try {
        let authUser = usuariosExistentes.get(email);
        if (!authUser) {
          const password = crypto.randomUUID() + crypto.randomUUID() + "!Aa9";
          const { data: criado, error: erroCriacao } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              nome: vendedor.nome,
              vendedor_id: vendedor.id,
              origem: "IMPORTACAO_VENDEDORES",
            },
          });
          if (erroCriacao) throw erroCriacao;
          authUser = criado.user;
          resultado.criados.push({ nome: vendedor.nome, email, codigo: vendedor.codigo_protheus });
        } else {
          resultado.jaExistiam.push({ nome: vendedor.nome, email, codigo: vendedor.codigo_protheus });
        }

        if (!authUser?.id) throw new Error("Usuário Auth criado sem UUID.");

        // Atualizações de vínculo não devem sobrescrever cargos definidos no portal.
        const { error: erroCriarPerfil } = await supabase.from("usuarios").upsert(
          { id: authUser.id, nome: vendedor.nome, email, perfil: "VENDEDOR",
            vendedor_id: vendedor.id, ativo: true },
          { onConflict: "id", ignoreDuplicates: true }
        );
        if (erroCriarPerfil) throw erroCriarPerfil;
        const { error: erroPerfil } = await supabase.from("usuarios")
          .update({ nome: vendedor.nome, email, vendedor_id: vendedor.id })
          .eq("id", authUser.id);
        if (erroPerfil) throw erroPerfil;
      } catch (erro) {
        resultado.erros.push({
          vendedor: vendedor.nome,
          email,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    return Response.json({
      sucesso: true,
      resumo: {
        vendedores: resultado.vendedoresEncontrados,
        criados: resultado.criados.length,
        jaExistiam: resultado.jaExistiam.length,
        erros: resultado.erros.length,
      },
      detalhes: resultado,
    });
  } catch (erro) {
    return Response.json({ sucesso: false, erro: erro instanceof Error ? erro.message : String(erro) }, { status: 500 });
  }
});
