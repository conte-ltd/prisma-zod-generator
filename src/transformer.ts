import type { DMMF as PrismaDMMF } from '@prisma/generator-helper';
import path from 'path';
import { TransformerParams } from './types';
import { SourceFile, VariableDeclarationKind } from 'ts-morph';
import { capitalizeFirstLetter } from './utils/capitalizeFirstLetter';

export default class Transformer {
  sourceFile: SourceFile;
  name: string;
  fields: (PrismaDMMF.SchemaArg | PrismaDMMF.Field)[];
  enumType: Partial<PrismaDMMF.SchemaEnum>;
  static enumNames: string[] = [];
  private static outputPath: string = './generated';
  private hasJson = false;
  static isDefaultPrismaClientOutput?: boolean;
  static prismaClientOutputPath?: string;

  constructor(params: TransformerParams) {
    this.sourceFile = params.sourceFile;
    this.name = params.name ?? '';
    this.fields = params.fields ?? [];
    this.enumType = params.enumType ?? {};
  }

  static setOutputPath(outPath: string) {
    this.outputPath = outPath;
  }

  getPrismaStringLine(
    field: PrismaDMMF.SchemaArg,
    inputType: PrismaDMMF.SchemaArgInputType,
    inputsLength: number,
  ) {
    const isEnum = inputType.location === 'enumTypes';

    const arr = inputType.isList ? '.array()' : '';
    const opt = !field.isRequired ? '.optional()' : '';

    if (isEnum) {
      const enumSchemaLine = `${inputType.type}Schema`;
      return inputsLength === 1
        ? `  ${field.name}: ${enumSchemaLine}${arr}${opt}`
        : `${enumSchemaLine}${arr}${opt}`;
    }

    const objectSchemaLine = `${inputType.type}ObjectSchema`;
    return inputsLength === 1
      ? `  ${field.name}: z.lazy(() => ${objectSchemaLine})${arr}${opt}`
      : `z.lazy(() => ${objectSchemaLine})${arr}${opt}`;
  }

  wrapWithZodValidators(
    mainValidator: string,
    field: PrismaDMMF.SchemaArg,
    inputType: PrismaDMMF.SchemaArgInputType,
  ) {
    let line: string = '';
    line = mainValidator;

    if (inputType.isList) {
      line += '.array()';
    }

    if (!field.isRequired) {
      line += '.optional()';
    }

    return line;
  }

  getObjectSchemaLine(
    field: PrismaDMMF.SchemaArg,
  ): [string, PrismaDMMF.SchemaArg, boolean][] {
    let lines = field.inputTypes;

    if (lines.length === 0) {
      return [];
    }

    let alternatives = lines.reduce<string[]>((result, inputType) => {
      if (inputType.type === 'String') {
        result.push(this.wrapWithZodValidators('z.string()', field, inputType));
      } else if (
        inputType.type === 'Int' ||
        inputType.type === 'Float' ||
        inputType.type === 'Decimal'
      ) {
        result.push(this.wrapWithZodValidators('z.number()', field, inputType));
      } else if (inputType.type === 'BigInt') {
        result.push(this.wrapWithZodValidators('z.bigint()', field, inputType));
      } else if (inputType.type === 'Boolean') {
        result.push(
          this.wrapWithZodValidators('z.boolean()', field, inputType),
        );
      } else if (inputType.type === 'DateTime') {
        result.push(this.wrapWithZodValidators('z.date()', field, inputType));
      } else if (inputType.type === 'Json') {
        this.hasJson = true;

        result.push(this.wrapWithZodValidators('jsonSchema', field, inputType));
      } else {
        if (inputType.type !== 'Null') {
          result.push(this.getPrismaStringLine(field, inputType, lines.length));
        }
      }

      return result;
    }, []);

    if (alternatives.length === 0) {
      return [];
    }

    if (alternatives.length > 1) {
      alternatives = alternatives.map((alter) =>
        alter.replace('.optional()', ''),
      );
    }

    const fieldName = alternatives.some((alt) => alt.includes(':'))
      ? ''
      : `  ${field.name}:`;

    const opt = !field.isRequired ? '.optional()' : '';

    let resString =
      alternatives.length === 1
        ? alternatives.join(',\r\n')
        : `z.union([${alternatives.join(',\r\n')}])${opt}`;

    if (field.isNullable) {
      resString += '.nullable()';
    }

    return [[`  ${fieldName} ${resString} `, field, true]];
  }

  getFieldValidators(
    zodStringWithMainType: string,
    field: PrismaDMMF.SchemaArg,
  ) {
    const { isRequired, isNullable } = field;

    if (!isRequired) {
      zodStringWithMainType += '.optional()';
    }

    if (isNullable) {
      zodStringWithMainType += '.nullable()';
    }

    return zodStringWithMainType;
  }

  addZodImport() {
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: 'zod',
      namedImports: ['z'],
    });
  }

  addPrismaTypeImport() {
    let prismaClientPath = '@prisma/client';
    if (Transformer.isDefaultPrismaClientOutput) {
      prismaClientPath = Transformer.prismaClientOutputPath ?? '';
      prismaClientPath = path
        .relative(
          path.join(Transformer.outputPath, 'objects'),
          prismaClientPath,
        )
        .split(path.sep)
        .join(path.posix.sep);
    }

    this.sourceFile.addImportDeclaration({
      moduleSpecifier: prismaClientPath,
      namedImports: ['Prisma'],
      isTypeOnly: true,
    });
  }

  addFieldsSchemaImport(
    fields: PrismaDMMF.SchemaArg[],
    inObjectsPath?: boolean,
  ) {
    const enumImports = new Set(
      fields.flatMap(({ inputTypes }) => {
        return inputTypes
          .filter((inputType) => {
            const isEnum = inputType.location === 'enumTypes';
            return (
              isEnum &&
              inputType.type !== this.name &&
              typeof inputType.type === 'string'
            );
          })
          .map((inputType) => {
            return inputType.type as string;
          });
      }),
    );
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: inObjectsPath ? '../enums' : './enums',
      namedImports: [...enumImports].map((name) => `${name}Schema`),
    });

    const objectImports = new Set(
      fields.flatMap(({ inputTypes }) => {
        return inputTypes
          .filter((inputType) => {
            const isEnum = inputType.location === 'enumTypes';
            return (
              !isEnum &&
              inputType.namespace === 'prisma' &&
              inputType.type !== this.name &&
              typeof inputType.type === 'string'
            );
          })
          .map((inputType) => {
            return inputType.type as string;
          });
      }),
    );
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: inObjectsPath ? './index' : './objects',
      namedImports: [...objectImports].map((name) => `${name}ObjectSchema`),
    });
  }

  getJsonSchemaImplementation() {
    let jsonShemaImplementation = '';

    if (this.hasJson) {
      jsonShemaImplementation += `\n`;
      jsonShemaImplementation += `const literalSchema = z.union([z.string(), z.number(), z.boolean()]);\n`;
      jsonShemaImplementation += `const jsonSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>\n`;
      jsonShemaImplementation += `  z.union([literalSchema, z.array(jsonSchema.nullable()), z.record(jsonSchema.nullable())])\n`;
      jsonShemaImplementation += `);\n\n`;
    }

    return jsonShemaImplementation;
  }

  getExportObjectSchema(schema: string, name: string) {
    const schemaName = `${name}ObjectSchema`;
    const end = `export const ${schemaName} = ${schemaName}Base as z.ZodType<Prisma.${name}>`;
    return `export const ${schemaName}Base = ${schema};\n${end}`;
  }

  getExportSchema(schema: string, name: string) {
    return `export const ${name}Schema = ${schema}`;
  }

  wrapWithZodObject(zodStringFields: string | string[]) {
    let wrapped = '';

    wrapped += 'z.object({';
    wrapped += '\n';
    wrapped += '  ' + zodStringFields;
    wrapped += '\n';
    wrapped += '})';
    return wrapped;
  }

  wrapWithZodOUnion(zodStringFields: string[]) {
    let wrapped = '';

    wrapped += 'z.union([';
    wrapped += '\n';
    wrapped += '  ' + zodStringFields.join(',');
    wrapped += '\n';
    wrapped += '])';
    return wrapped;
  }

  getZodObject(fields: PrismaDMMF.SchemaArg[]) {
    const objectSchemaLines = fields
      .map((field) => this.getObjectSchemaLine(field))
      .flatMap((item) => item);
    const zodStringFields = objectSchemaLines.map((item) => {
      const [zodStringWithMainType, field, skipValidators] = item;

      const value = skipValidators
        ? zodStringWithMainType
        : this.getFieldValidators(zodStringWithMainType, field);

      return value.trim();
    });

    const shouldWrapWithUnion = zodStringFields.some(
      (field) =>
        // TODO handle other cases if any
        // field.includes('create:') ||
        field.includes('connectOrCreate:') || field.includes('connect:'),
    );

    if (!shouldWrapWithUnion) {
      return this.wrapWithZodObject(zodStringFields) + '.strict()';
    }

    const wrapped = zodStringFields.map(
      (field) => this.wrapWithZodObject(field) + '.strict()',
    );

    return this.wrapWithZodOUnion(wrapped);
  }

  printObjectSchemas() {
    const fields = this.fields as PrismaDMMF.SchemaArg[];

    this.addPrismaTypeImport();
    this.addZodImport();
    this.addFieldsSchemaImport(fields, true);

    const objectSchema = `${this.getExportObjectSchema(
      this.getZodObject(fields),
      this.name,
    )}\n`;

    const json = this.getJsonSchemaImplementation();
    this.sourceFile.addStatements([json, objectSchema]);

    return this.sourceFile;
  }

  printSelectObjectSchemas(isInclude?: boolean) {
    const fields = this.fields as PrismaDMMF.Field[];
    const relatedFields = fields.filter((field) => field.kind === 'object');

    this.addPrismaTypeImport();
    this.addZodImport();

    if (relatedFields.length > 0) {
      this.sourceFile.addImportDeclaration({
        moduleSpecifier: '../index',
        namedImports: [
          ...new Set(
            relatedFields
              .filter((field) => field.isList)
              .map((field) => {
                return `FindMany${field.type}Schema`;
              }),
          ),
        ],
      });

      this.sourceFile.addImportDeclaration({
        moduleSpecifier: './index',
        namedImports: [
          ...new Set(
            relatedFields
              .filter((field) => !field.isList)
              .map((field) => {
                return `${field.type}ArgsObjectSchema`;
              }),
          ),
        ],
      });
    }

    const fieldSchemas = (isInclude ? relatedFields : fields).reduce(
      (prev, field) => {
        if (field.kind === 'object') {
          if (field.isList) {
            return `${prev}${field.name}: z.union([z.lazy(() => FindMany${field.type}Schema), z.boolean()]).optional(), `;
          } else {
            return `${prev}${field.name}: z.union([z.lazy(() => ${field.type}ArgsObjectSchema), z.boolean()]).optional(), `;
          }
        } else {
          return `${prev}${field.name}: z.boolean().optional(), `;
        }
      },
      ``,
    );

    this.sourceFile.addVariableStatements([
      {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
          {
            name: `${this.name}ObjectSchemaBase`,
            initializer: `z.object({ ${fieldSchemas} })`,
          },
        ],
        isExported: true,
      },
      {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
          {
            name: `${this.name}ObjectSchema`,
            initializer: `${this.name}ObjectSchemaBase as z.ZodType<Prisma.${this.name}>`,
          },
        ],
        isExported: true,
      },
    ]);

    return this.sourceFile;
  }

  printArgsObjectSchemas(modelName: string) {
    this.addPrismaTypeImport();
    this.addZodImport();
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: './index',
      namedImports: [
        `${modelName}SelectObjectSchema`,
        `${modelName}IncludeObjectSchema`,
      ],
    });

    this.sourceFile.addVariableStatements([
      {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
          {
            name: `${this.name}ObjectSchemaBase`,
            initializer: `z.object({ select: z.lazy(() => ${modelName}SelectObjectSchema).optional(), include: z.lazy(() => ${modelName}IncludeObjectSchema).optional() })`,
          },
        ],
        isExported: true,
      },
      {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
          {
            name: `${this.name}ObjectSchema`,
            initializer: `${this.name}ObjectSchemaBase as z.ZodType<Prisma.${this.name}>`,
          },
        ],
        isExported: true,
      },
    ]);

    return this.sourceFile;
  }

  printModelSchema() {
    const fields = this.fields as PrismaDMMF.SchemaArg[];

    this.addZodImport();
    this.addFieldsSchemaImport(fields);

    this.sourceFile.addVariableStatement({
      isExported: true,
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: `${capitalizeFirstLetter(this.name)}Schema`,
          initializer: this.getZodObject(fields),
        },
      ],
    });

    return this.sourceFile;
  }

  printEnumSchemas() {
    const { name, values } = this.enumType;

    this.addZodImport();
    this.sourceFile.addStatements(
      this.getExportSchema(`z.enum(${JSON.stringify(values)})`, `${name}`),
    );

    return this.sourceFile;
  }
}
