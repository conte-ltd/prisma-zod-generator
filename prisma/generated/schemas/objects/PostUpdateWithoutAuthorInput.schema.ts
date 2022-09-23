import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { NullableJsonNullValueInputSchema, PostStatusSchema } from '../enums';
import {
  StringFieldUpdateOperationsInputObjectSchema,
  DateTimeFieldUpdateOperationsInputObjectSchema,
  NullableStringFieldUpdateOperationsInputObjectSchema,
  PostUpdatetagsInputObjectSchema,
  BoolFieldUpdateOperationsInputObjectSchema,
  IntFieldUpdateOperationsInputObjectSchema,
  CategoryUpdateOneWithoutPostsNestedInputObjectSchema,
  BigIntFieldUpdateOperationsInputObjectSchema,
  EnumPostStatusFieldUpdateOperationsInputObjectSchema,
} from './index';

const literalSchema = z.union([z.string(), z.number(), z.boolean()]);
const jsonSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    literalSchema,
    z.array(jsonSchema.nullable()),
    z.record(jsonSchema.nullable()),
  ]),
);

export const PostUpdateWithoutAuthorInputObjectSchemaBase = z
  .object({
    id: z
      .union([
        z.string(),
        z.lazy(() => StringFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    createdAt: z
      .union([
        z.date(),
        z.lazy(() => DateTimeFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    updatedAt: z
      .union([
        z.date(),
        z.lazy(() => DateTimeFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    title: z
      .union([
        z.string(),
        z.lazy(() => StringFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    content: z
      .union([
        z.string(),
        z.lazy(() => NullableStringFieldUpdateOperationsInputObjectSchema),
      ])
      .optional()
      .nullable(),
    tags: z
      .union([
        z.lazy(() => PostUpdatetagsInputObjectSchema),
        z.string().array(),
      ])
      .optional(),
    info: z.union([NullableJsonNullValueInputSchema, jsonSchema]).optional(),
    published: z
      .union([
        z.boolean(),
        z.lazy(() => BoolFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    viewCount: z
      .union([
        z.number(),
        z.lazy(() => IntFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    category: z
      .lazy(() => CategoryUpdateOneWithoutPostsNestedInputObjectSchema)
      .optional(),
    likes: z
      .union([
        z.bigint(),
        z.lazy(() => BigIntFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
    status: z
      .union([
        PostStatusSchema,
        z.lazy(() => EnumPostStatusFieldUpdateOperationsInputObjectSchema),
      ])
      .optional(),
  })
  .strict();
export const PostUpdateWithoutAuthorInputObjectSchema: z.ZodType<Prisma.PostUpdateWithoutAuthorInput> =
  PostUpdateWithoutAuthorInputObjectSchemaBase;
