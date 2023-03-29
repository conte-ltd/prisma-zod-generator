import { parseEnvValue, getDMMF } from '@prisma/internals';
import { EnvValue, GeneratorOptions } from '@prisma/generator-helper';
import removeDir from './utils/removeDir';
import { promises as fs } from 'fs';
import Transformer from './transformer';
import { project } from './project';
import path from 'path';
import { capitalizeFirstLetter } from './utils/capitalizeFirstLetter';
import { formatFile } from './utils/formatFile';

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

  const routeFile = project.createSourceFile(
    path.resolve(outputDir, 'index.ts'),
  );

  const enumRouteFile = project.createSourceFile(
    path.resolve(outputDir, 'enums/index.ts'),
    undefined,
    {
      overwrite: true,
    },
  );

  const enumTypes = [
    ...prismaClientDmmf.schema.enumTypes.prisma,
    ...(prismaClientDmmf.schema.enumTypes.model ?? []),
  ];
  const enumNames = enumTypes.map((enumItem) => enumItem.name);
  Transformer.enumNames = enumNames ?? [];

  for (const enumType of enumTypes) {
    const enumsObj = new Transformer({
      enumType,
      sourceFile: project.createSourceFile(
        path.resolve(outputDir, `enums/${enumType.name}.schema.ts`),
        undefined,
        { overwrite: true },
      ),
    });
    const sourceFile = enumsObj.printEnumSchemas();
    const formattedText = await formatFile(sourceFile.getFullText());
    sourceFile.replaceWithText(formattedText);

    enumRouteFile.addExportDeclaration({
      moduleSpecifier: `./${enumType.name}.schema`,
    });
  }

  const objectRouteFile = project.createSourceFile(
    path.resolve(outputDir, 'objects/index.ts'),
    undefined,
    {
      overwrite: true,
    },
  );

  for (
    let i = 0;
    i < prismaClientDmmf.schema.inputObjectTypes.prisma.length;
    i += 1
  ) {
    const fields = prismaClientDmmf.schema.inputObjectTypes.prisma[
      i
    ]?.fields.map((field) => ({
      ...field,
      inputTypes: field.inputTypes.filter((inputType) => {
        const exclusion =
          typeof inputType.type === 'string' &&
          inputType.type.endsWith('RefInput');
        return !exclusion;
      }),
    }));
    const name = prismaClientDmmf.schema.inputObjectTypes.prisma[i]?.name;
    const obj = new Transformer({
      name,
      fields,
      sourceFile: project.createSourceFile(
        path.resolve(outputDir, `objects/${name}.schema.ts`),
        undefined,
        { overwrite: true },
      ),
    });
    const sourceFile = obj.printObjectSchemas();
    const formattedText = await formatFile(sourceFile.getFullText());
    sourceFile.replaceWithText(formattedText);

    objectRouteFile.addExportDeclaration({
      moduleSpecifier: `./${name}.schema`,
    });
  }

  for (let i = 0; i < prismaClientDmmf.datamodel.models.length; i += 1) {
    const fields = prismaClientDmmf.datamodel.models[i]?.fields;
    const modelName = prismaClientDmmf.datamodel.models[i]?.name;

    let name = `${modelName}Select`;
    let obj = new Transformer({
      name,
      fields,
      sourceFile: project.createSourceFile(
        path.resolve(outputDir, `objects/${name}.schema.ts`),
        undefined,
        { overwrite: true },
      ),
    });
    let sourceFile = obj.printSelectObjectSchemas();
    let formattedText = await formatFile(sourceFile.getFullText());
    sourceFile.replaceWithText(formattedText);

    objectRouteFile.addExportDeclaration({
      moduleSpecifier: `./${name}.schema`,
    });

    const hasRelatedField = fields.some((field) => field.relationName);

    if (hasRelatedField) {
      name = `${modelName}Include`;
      obj = new Transformer({
        name,
        fields,
        sourceFile: project.createSourceFile(
          path.resolve(outputDir, `objects/${name}.schema.ts`),
          undefined,
          { overwrite: true },
        ),
      });
      sourceFile = obj.printSelectObjectSchemas(true);
      formattedText = await formatFile(sourceFile.getFullText());
      sourceFile.replaceWithText(formattedText);

      objectRouteFile.addExportDeclaration({
        moduleSpecifier: `./${name}.schema`,
      });

      name = `${modelName}Args`;
      obj = new Transformer({
        name,
        fields,
        sourceFile: project.createSourceFile(
          path.resolve(outputDir, `objects/${name}.schema.ts`),
          undefined,
          { overwrite: true },
        ),
      });
      sourceFile = obj.printArgsObjectSchemas(modelName);
      formattedText = await formatFile(sourceFile.getFullText());
      sourceFile.replaceWithText(formattedText);

      objectRouteFile.addExportDeclaration({
        moduleSpecifier: `./${name}.schema`,
      });
    }
  }

  const models = prismaClientDmmf.datamodel.models;

  for (const outputType of prismaClientDmmf.schema.outputObjectTypes.prisma) {
    if (outputType.name !== 'Query' && outputType.name !== 'Mutation') {
      continue;
    }

    for (const field of outputType.fields) {
      const name = field.name;
      const modelName = getModelNameWithSelect(name)?.replace('OrThrow', '');
      const hasRelated = models
        .filter((model) => model.name === modelName)
        .some((model) => model.fields.some((field) => field.relationName));

      const fields = name.startsWith('groupBy')
        ? field.args.map((arg) => {
            if (arg.name === 'orderBy') {
              return {
                ...arg,
                isRequired: true,
              };
            } else if (arg.name === 'by') {
              return {
                ...arg,
                inputTypes: arg.inputTypes.filter(
                  (inputType) => inputType.isList,
                ),
              };
            } else {
              return arg;
            }
          })
        : field.args;

      if (modelName) {
        fields.push({
          name: 'select',
          isRequired: false,
          isNullable: false,
          inputTypes: [
            {
              type: `${modelName}Select`,
              namespace: 'prisma',
              location: 'inputObjectTypes',
              isList: false,
            },
          ],
        });

        if (hasRelated) {
          fields.push({
            name: 'include',
            isRequired: false,
            isNullable: false,
            inputTypes: [
              {
                type: `${modelName}Include`,
                namespace: 'prisma',
                location: 'inputObjectTypes',
                isList: false,
              },
            ],
          });
        }
      }

      if (name === 'executeRaw' || name === 'queryRaw') {
        continue;
      }

      const obj = new Transformer({
        name,
        fields,
        sourceFile: project.createSourceFile(
          path.resolve(outputDir, `${capitalizeFirstLetter(name)}.schema.ts`),
          undefined,
          { overwrite: true },
        ),
      });
      const sourceFile = obj.printModelSchema();
      const formattedText = await formatFile(sourceFile.getFullText());
      sourceFile.replaceWithText(formattedText);

      routeFile.addExportDeclaration({
        moduleSpecifier: `./${capitalizeFirstLetter(name)}.schema`,
      });
    }
  }

  routeFile.addExportDeclaration({
    moduleSpecifier: './enums',
  });
  routeFile.addExportDeclaration({
    moduleSpecifier: './objects',
  });

  await project.save();
}

function getModelNameWithSelect(name: string) {
  for (const method of [
    'findUnique',
    'findFirst',
    'findMany',
    'createOne',
    'updateOne',
    'upsertOne',
    'deleteOne',
  ]) {
    if (name.startsWith(method)) {
      return name.replace(method, '');
    }
  }

  return null;
}
