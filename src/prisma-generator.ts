import { parseEnvValue, getDMMF } from '@prisma/internals';
import { EnvValue, GeneratorOptions } from '@prisma/generator-helper';
import removeDir from './utils/removeDir';
import { promises as fs } from 'fs';
import Transformer from './transformer';

export async function generate(options: GeneratorOptions) {
  const outputDir = parseEnvValue(options.generator.output as EnvValue);
  await fs.mkdir(outputDir, { recursive: true });
  await removeDir(outputDir, true);

  const prismaClientProvider = options.otherGenerators.find(
    (it) => parseEnvValue(it.provider) === 'prisma-client-js',
  );

  const prismaClientDmmf = await getDMMF({
    datamodel: options.datamodel,
    previewFeatures: prismaClientProvider?.previewFeatures,
  });

  Transformer.isDefaultPrismaClientOutput =
    prismaClientProvider?.isCustomOutput ?? false;

  if (prismaClientProvider?.isCustomOutput) {
    Transformer.prismaClientOutputPath =
      prismaClientProvider?.output?.value ?? '';
  }

  Transformer.setOutputPath(outputDir);

  const enumTypes = [
    ...prismaClientDmmf.schema.enumTypes.prisma,
    ...(prismaClientDmmf.schema.enumTypes.model ?? []),
  ];
  const enumNames = enumTypes.map((enumItem) => enumItem.name);
  Transformer.enumNames = enumNames ?? [];
  const enumsObj = new Transformer({
    enumTypes,
  });
  await enumsObj.printEnumSchemas();

  for (
    let i = 0;
    i < prismaClientDmmf.schema.inputObjectTypes.prisma.length;
    i += 1
  ) {
    const fields = prismaClientDmmf.schema.inputObjectTypes.prisma[i]?.fields;
    const name = prismaClientDmmf.schema.inputObjectTypes.prisma[i]?.name;
    const obj = new Transformer({ name, fields });
    await obj.printObjectSchemas();
  }

  for (let i = 0; i < prismaClientDmmf.datamodel.models.length; i += 1) {
    const fields = prismaClientDmmf.datamodel.models[i]?.fields;
    const name = prismaClientDmmf.datamodel.models[i]?.name;
    const obj = new Transformer({ name, fields });
    await obj.printSelectObjectSchemas();
    await obj.printIncludeObjectSchemas();
    await obj.printArgsObjectSchemas();
  }

  const obj = new Transformer({
    modelOperations: prismaClientDmmf.mappings.modelOperations,
  });
  await obj.printModelSchemas();
}
