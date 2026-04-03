type MetaobjectDefinitionField = {
  key: string;
  name: string;
  description?: string | null;
  required?: boolean | null;
  type?: {
    name: string;
  } | null;
  validations?: Array<{
    name: string;
    value?: string | null;
  }> | null;
};

type MetaobjectDefinitionRecord = {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  displayNameKey?: string | null;
  metaobjectsCount?: number | null;
  access?: {
    admin?: string | null;
    storefront?: string | null;
  } | null;
  capabilities?: {
    publishable?: {
      enabled: boolean;
    } | null;
    translatable?: {
      enabled: boolean;
    } | null;
    renderable?: {
      enabled: boolean;
    } | null;
  } | null;
  fieldDefinitions: MetaobjectDefinitionField[];
};

function formatFieldDefinitions(fields: MetaobjectDefinitionField[]) {
  return fields.map((field) => ({
    key: field.key,
    name: field.name,
    description: field.description ?? null,
    required: field.required ?? undefined,
    type: field.type?.name,
    validations:
      field.validations?.map((validation) => ({
        name: validation.name,
        value: validation.value ?? null
      })) ?? []
  }));
}

function formatDefinition(definition: MetaobjectDefinitionRecord) {
  return {
    id: definition.id,
    type: definition.type,
    name: definition.name,
    description: definition.description ?? null,
    displayNameKey: definition.displayNameKey ?? null,
    metaobjectsCount: definition.metaobjectsCount ?? null,
    access: {
      admin: definition.access?.admin ?? null,
      storefront: definition.access?.storefront ?? null
    },
    capabilities: {
      publishable: definition.capabilities?.publishable?.enabled ?? false,
      translatable: definition.capabilities?.translatable?.enabled ?? false,
      renderable: definition.capabilities?.renderable?.enabled ?? false
    },
    fieldDefinitions: formatFieldDefinitions(definition.fieldDefinitions)
  };
}

export { formatDefinition };
