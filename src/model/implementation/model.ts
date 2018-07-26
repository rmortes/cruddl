import { groupBy, uniqBy } from 'lodash';
import memorize from 'memorize-decorator';
import { DEFAULT_PERMISSION_PROFILE } from '../../schema/constants';
import { flatMap, objectValues } from '../../utils/utils';
import { ModelConfig, TypeKind } from '../config';
import { ValidationMessage, ValidationResult } from '../validation';
import { ModelComponent, ValidationContext } from '../validation/validation-context';
import { builtInTypeNames, builtInTypes } from './built-in-types';
import { ChildEntityType } from './child-entity-type';
import { EntityExtensionType } from './entity-extension-type';
import { EnumType } from './enum-type';
import { Namespace } from './namespace';
import { createPermissionMap, PermissionProfile, PermissionProfileMap } from './permission-profile';
import { Relation } from './relation';
import { RootEntityType } from './root-entity-type';
import { ScalarType } from './scalar-type';
import { createType, InvalidType, ObjectType, Type } from './type';
import { ValueObjectType } from './value-object-type';

export class Model implements ModelComponent {
    private readonly typeMap: ReadonlyMap<string, Type>;

    readonly rootNamespace: Namespace;
    readonly namespaces: ReadonlyArray<Namespace>;
    readonly types: ReadonlyArray<Type>;
    readonly permissionProfiles: PermissionProfileMap;

    constructor(private input: ModelConfig) {
        this.permissionProfiles = createPermissionMap(input.permissionProfiles);
        this.types = [
            ...builtInTypes,
            ...input.types.map(typeInput => createType(typeInput, this))
        ];
        this.rootNamespace = new Namespace(undefined, [], this.rootEntityTypes);
        this.namespaces = [this.rootNamespace, ...this.rootNamespace.descendantNamespaces];
        this.typeMap = new Map(this.types.map((type): [string, Type] => ([type.name, type])));
        this.autoExtendDescriptions();
    }

    validate(context = new ValidationContext()): ValidationResult {
        this.validateDuplicateTypes(context);

        for (const type of this.types) {
            type.validate(context);
        }

        return new ValidationResult([
            ...this.input.validationMessages || [],
            ...context.validationMessages
        ]);
    }

    private validateDuplicateTypes(context: ValidationContext) {
        const duplicateTypes = objectValues(groupBy(this.types, type => type.name)).filter(types => types.length > 1);
        for (const types of duplicateTypes) {
            for (const type of types) {
                if (builtInTypes.includes(type)) {
                    // don't report errors for built-in types
                    continue;
                }

                if (builtInTypeNames.has(type.name)) {
                    // user does not see duplicate type, so provide better message
                    context.addMessage(ValidationMessage.error(`Type name "${type.name}" is reserved by a built-in type.`, type.nameASTNode));
                } else {
                    context.addMessage(ValidationMessage.error(`Duplicate type name: "${type.name}".`, type.nameASTNode));
                }
            }
        }
    }

    private autoExtendDescriptions() {
        for (const type of this.typeMap.values()) {
            if (type.kind !== TypeKind.ENUM && type.kind !== TypeKind.SCALAR) {
                type.fields.filter(field => field.isReference).forEach(field => {
                    const type = field.type;
                    if (type && type.kind == TypeKind.ROOT_ENTITY) {
                        field.description = (field.description ? field.description + '\n\n' : '') + 'This field references a ' + type.name + ' by its ' + (type.keyField ? type.keyField.name : 'key') + ' field';
                    }
                });
            }
        }
    }

    getType(name: string): Type | undefined {
        return this.typeMap.get(name);
    }

    getTypeOrFallback(name: string): Type {
        return this.typeMap.get(name) || new InvalidType(name);
    }

    getTypeOrThrow(name: string): Type {
        const type = this.typeMap.get(name);
        if (!type) {
            throw new Error(`Reference to undefined type "${name}"`);
        }
        return type;
    }

    getPermissionProfile(name: string): PermissionProfile | undefined {
        return this.permissionProfiles[name];
    }

    getPermissionProfileOrThrow(name: string): PermissionProfile {
        const profile = this.getPermissionProfile(name);
        if (profile == undefined) {
            throw new Error(`Permission profile "${name}" does not exist`);
        }
        return profile;
    }

    get defaultPermissionProfile(): PermissionProfile | undefined {
        return this.getPermissionProfile(DEFAULT_PERMISSION_PROFILE);
    }

    get rootEntityTypes(): ReadonlyArray<RootEntityType> {
        return this.types.filter(t => t.kind === TypeKind.ROOT_ENTITY) as ReadonlyArray<RootEntityType>;
    }

    get childEntityTypes(): ReadonlyArray<ChildEntityType> {
        return this.types.filter(t => t.kind === TypeKind.CHILD_ENTITY) as ReadonlyArray<ChildEntityType>;
    }

    get entityExtensionTypes(): ReadonlyArray<EntityExtensionType> {
        return this.types.filter(t => t.kind === TypeKind.ENTITY_EXTENSION) as ReadonlyArray<EntityExtensionType>;
    }

    get valueObjectTypes(): ReadonlyArray<ValueObjectType> {
        return this.types.filter(t => t.kind === TypeKind.VALUE_OBJECT) as ReadonlyArray<ValueObjectType>;
    }

    get scalarTypes(): ReadonlyArray<ScalarType> {
        return this.types.filter(t => t.kind === TypeKind.SCALAR) as ReadonlyArray<ScalarType>;
    }

    get enumTypes(): ReadonlyArray<EnumType> {
        return this.types.filter(t => t.kind === TypeKind.ENUM) as ReadonlyArray<EnumType>;
    }

    getObjectTypeOrThrow(name: string): ObjectType {
        const type = this.getTypeOrThrow(name);
        if (!type.isObjectType) {
            throw new Error(`Expected type "${name}" to be an object type, but is ${type.kind}`);
        }
        return type;
    }

    getRootEntityTypeOrThrow(name: string): RootEntityType {
        return this.getTypeOfKindOrThrow(name, TypeKind.ROOT_ENTITY);
    }

    getChildEntityTypeOrThrow(name: string): ChildEntityType {
        return this.getTypeOfKindOrThrow(name, TypeKind.CHILD_ENTITY);
    }

    getValueObjectTypeOrThrow(name: string): ValueObjectType {
        return this.getTypeOfKindOrThrow(name, TypeKind.VALUE_OBJECT);
    }

    getEntityExtensionTypeOrThrow(name: string): EntityExtensionType {
        return this.getTypeOfKindOrThrow(name, TypeKind.ENTITY_EXTENSION);
    }

    getScalarTypeOrThrow(name: string): ScalarType {
        return this.getTypeOfKindOrThrow(name, TypeKind.SCALAR);
    }

    getEnumTypeOrThrow(name: string): EnumType {
        return this.getTypeOfKindOrThrow(name, TypeKind.ENUM);
    }

    getRootEntityType(name: string): RootEntityType | undefined {
        return this.getTypeOfKind(name, TypeKind.ROOT_ENTITY);
    }

    getChildEntityType(name: string): ChildEntityType | undefined {
        return this.getTypeOfKind(name, TypeKind.CHILD_ENTITY);
    }

    getValueObjectType(name: string): ValueObjectType | undefined {
        return this.getTypeOfKind(name, TypeKind.VALUE_OBJECT);
    }

    getEntityExtensionType(name: string): EntityExtensionType | undefined {
        return this.getTypeOfKind(name, TypeKind.ENTITY_EXTENSION);
    }

    getScalarType(name: string): ScalarType | undefined {
        return this.getTypeOfKind(name, TypeKind.SCALAR);
    }

    getEnumType(name: string): EnumType | undefined {
        return this.getTypeOfKind(name, TypeKind.ENUM);
    }

    getTypeOfKindOrThrow<T extends Type>(name: string, kind: TypeKind): T {
        const type = this.getTypeOrThrow(name);
        if (type.kind != kind) {
            throw new Error(`Expected type "${name}" to be a a ${kind}, but is ${type.kind}`);
        }
        return type as T;
    }

    getTypeOfKind<T extends Type>(name: string, kind: TypeKind): T | undefined {
        const type = this.getType(name);
        if (!type || type.kind != kind) {
            return undefined;
        }
        return type as T;
    }

    getNamespaceByPath(path: ReadonlyArray<string>): Namespace | undefined {
        let curNamespace: Namespace | undefined = this.rootNamespace;
        for (const seg of path) {
            curNamespace = curNamespace.getChildNamespace(seg);
            if (!curNamespace) {
                return undefined;
            }
        }
        return curNamespace;
    }

    getNamespaceByPathOrThrow(path: ReadonlyArray<string>): Namespace {
        const result = this.getNamespaceByPath(path);
        if (result == undefined) {
            throw new Error(`Namespace ` + path.join('.') + ` does not exist`);
        }
        return result;
    }

    /**
     * Gets a list of all relations between any
     */
    @memorize()
    get relations(): ReadonlyArray<Relation> {
        const withDuplicates = flatMap(this.rootEntityTypes, entity => entity.explicitRelations);
        return uniqBy(withDuplicates, rel => rel.identifier);
    }
}
