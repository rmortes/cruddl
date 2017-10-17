import {ASTTransformer} from "../ast-transformer";
import {
    DocumentNode,
    FieldDefinitionNode,
    GraphQLID,
    InputObjectTypeDefinitionNode,
    InputValueDefinitionNode,
    ObjectTypeDefinitionNode, ScalarTypeDefinitionNode,
    TypeNode
} from "graphql";
import {
    getChildEntityTypes,
    getNamedTypeDefinitionAST, getReferenceKeyField,
    getRootEntityTypes, getTypeNameIgnoringNonNullAndList,
    hasDirectiveWithName
} from "../../schema-utils";
import {
    INPUT_OBJECT_TYPE_DEFINITION,
    LIST_TYPE,
    NAMED_TYPE,
    NON_NULL_TYPE,
    OBJECT_TYPE_DEFINITION
} from "graphql/language/kinds";
import {getCreateInputTypeName} from "../../../graphql/names";
import {
    ENTITY_CREATED_AT, ENTITY_UPDATED_AT, ID_FIELD, KEY_FIELD_DIRECTIVE, REFERENCE_DIRECTIVE, RELATION_DIRECTIVE,
    ROOT_ENTITY_DIRECTIVE
} from "../../schema-defaults";
import {buildInputValueListNode, buildInputValueNode} from "./add-input-type-transformation-helper";

export class AddCreateEntityInputTypesTransformer implements ASTTransformer {

    transform(ast: DocumentNode): void {
        getRootEntityTypes(ast).forEach(objectType => {
            ast.definitions.push(this.createCreateInputTypeForObjectType(ast, objectType));
        });
        getChildEntityTypes(ast).forEach(objectType => {
            ast.definitions.push(this.createCreateInputTypeForObjectType(ast, objectType));
        });
    }

    protected createCreateInputTypeForObjectType(ast: DocumentNode, objectType: ObjectTypeDefinitionNode): InputObjectTypeDefinitionNode {
        // create input fields for all entity fields except ID, createdAt, updatedAt
        const skip = [ID_FIELD, ENTITY_CREATED_AT, ENTITY_UPDATED_AT];
        const args = [
            ...objectType.fields.filter(field => !skip.includes(field.name.value)).map(field => this.createInputTypeField(ast, field, field.type))
        ];
        return {
            kind: INPUT_OBJECT_TYPE_DEFINITION,
            name: { kind: "Name", value: getCreateInputTypeName(objectType) },
            fields: args,
            loc: objectType.loc
        }
    }

    protected createInputTypeField(ast: DocumentNode, field: FieldDefinitionNode, type: TypeNode): InputValueDefinitionNode {
        switch (type.kind) {
            case NON_NULL_TYPE:
                return this.createInputTypeField(ast, field, type.type);
            case NAMED_TYPE:
                const namedType = getNamedTypeDefinitionAST(ast, type.name.value);
                if (namedType.kind === OBJECT_TYPE_DEFINITION) {
                    // references are referred via @key type
                    if (hasDirectiveWithName(field, REFERENCE_DIRECTIVE)) {
                        return buildInputValueNode(field.name.value, getReferenceKeyField(namedType));
                    }
                    // relations are referenced via IDs
                    if (hasDirectiveWithName(field, RELATION_DIRECTIVE)) {
                        return buildInputValueNode(field.name.value, GraphQLID.name);
                    }
                    return buildInputValueNode(field.name.value, getCreateInputTypeName(namedType));
                } else {
                    return buildInputValueNode(field.name.value, type.name.value, field.loc);
                }
            case LIST_TYPE:
                const effectiveType = type.type.kind === NON_NULL_TYPE ? type.type.type : type.type;
                if (effectiveType.kind === LIST_TYPE) {
                    throw new Error('Lists of lists are not allowed.');
                }
                const namedTypeOfList = getNamedTypeDefinitionAST(ast, effectiveType.name.value);
                if (namedTypeOfList.kind === OBJECT_TYPE_DEFINITION) {
                    // references are referred via @key type
                    if (hasDirectiveWithName(field, RELATION_DIRECTIVE)) {
                        return buildInputValueListNode(field.name.value, GraphQLID.name, field.loc)
                    }
                    return buildInputValueListNode(field.name.value, getCreateInputTypeName(namedTypeOfList), field.loc)
                } else {
                    return buildInputValueListNode(field.name.value, effectiveType.name.value, field.loc);
                }
        }
    }

}


