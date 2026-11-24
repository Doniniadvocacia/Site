-- Dados pessoais do usuário (Editar cadastro). Contatos e documentos ficam cifrados pela aplicação.
ALTER TABLE usuarios ADD COLUMN cargo TEXT;
ALTER TABLE usuarios ADD COLUMN oab_numero TEXT;
ALTER TABLE usuarios ADD COLUMN oab_uf TEXT;
ALTER TABLE usuarios ADD COLUMN celular_enc TEXT;
ALTER TABLE usuarios ADD COLUMN telefone_enc TEXT;
ALTER TABLE usuarios ADD COLUMN cpf_enc TEXT;
ALTER TABLE usuarios ADD COLUMN nascimento_enc TEXT;
ALTER TABLE usuarios ADD COLUMN atualizado_em INTEGER;
