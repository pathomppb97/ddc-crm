--
-- DDC CRM - 8/8 - Reference data
--
-- Starter configuration only. Every row below can be changed from the
-- administration screens. The permission matrix, pipeline probabilities, code
-- lists and ERP contracts are PROPOSED DEFAULTS that DDC stakeholders must
-- review and confirm; they are not verified company rules.
-- No customer, product, price or other operational business data is seeded here.
--

insert into public.ddc_roles (key, name, name_en, description, is_system, sort_order) values
    ('system_admin', 'ผู้ดูแลระบบ', 'System Administrator', 'Full access, including configuration', true, 10),
    ('management', 'ผู้บริหาร', 'Management', 'Read access to all business data and reports, commercial approval', true, 20),
    ('sales_manager', 'ผู้จัดการฝ่ายขาย', 'Sales Manager', 'Manages all sales records, approves quotations', true, 30),
    ('sales_rep', 'พนักงานขาย', 'Sales Representative', 'Creates records and updates the records they own', true, 40),
    ('marketing', 'การตลาด', 'Marketing', 'Leads, activities and aftermarket network', true, 50),
    ('engineering', 'วิศวกรรม', 'Engineering', 'Products, fitment, RFQ engineering review, development projects', true, 60),
    ('quality', 'คุณภาพ', 'Quality', 'Complaints and service cases', true, 70),
    ('finance', 'การเงิน', 'Finance', 'Reads commercial data and ERP documents, commercial approval', true, 80),
    ('read_only', 'อ่านอย่างเดียว', 'Read-Only', 'Read access to business data', true, 90);

-- Compact permission seeding: role x resources x actions
create function pg_temp.grant_perm(p_role text, p_resources text[], p_actions text[], p_scope text default 'all') returns void
    language sql as $$
        insert into public.role_permissions (role_key, resource, action, scope)
        select p_role, r, a, p_scope from unnest(p_resources) r cross join unnest(p_actions) a
        on conflict (role_key, resource, action) do update set scope = excluded.scope
    $$;

select pg_temp.grant_perm('system_admin',
    array['customers','contacts','leads','opportunities','activities','tasks','products','fitment','rfqs','quotations',
          'dev_projects','aftermarket','service_cases','master_data','reports','erp_documents','erp_integration','audit_log','users'],
    array['read','create','update','delete','approve','export','import']);

select pg_temp.grant_perm('management',
    array['customers','contacts','leads','opportunities','activities','tasks','products','fitment','rfqs','quotations',
          'dev_projects','aftermarket','service_cases','master_data','reports','erp_documents','audit_log'],
    array['read']);
select pg_temp.grant_perm('management', array['customers','leads','opportunities','quotations','reports'], array['export']);
select pg_temp.grant_perm('management', array['quotations'], array['approve']);

select pg_temp.grant_perm('sales_manager',
    array['customers','contacts','leads','opportunities','activities','tasks','rfqs','quotations','aftermarket'],
    array['read','create','update','delete']);
select pg_temp.grant_perm('sales_manager',
    array['products','fitment','dev_projects','service_cases','master_data','reports','erp_documents'], array['read']);
select pg_temp.grant_perm('sales_manager', array['service_cases'], array['create','update']);
select pg_temp.grant_perm('sales_manager', array['quotations'], array['approve']);
select pg_temp.grant_perm('sales_manager', array['customers','contacts','leads'], array['import']);
select pg_temp.grant_perm('sales_manager', array['customers','contacts','leads','opportunities','quotations','reports'], array['export']);

select pg_temp.grant_perm('sales_rep',
    array['customers','contacts','leads','opportunities','activities','tasks','rfqs','quotations','products','fitment',
          'dev_projects','service_cases','aftermarket','master_data','reports'],
    array['read']);
select pg_temp.grant_perm('sales_rep',
    array['customers','contacts','leads','opportunities','activities','tasks','rfqs','quotations','service_cases'],
    array['create']);
select pg_temp.grant_perm('sales_rep',
    array['customers','contacts','leads','opportunities','activities','tasks','rfqs','quotations','service_cases'],
    array['update'], 'own');
select pg_temp.grant_perm('sales_rep', array['activities','tasks'], array['delete'], 'own');

select pg_temp.grant_perm('marketing',
    array['customers','contacts','leads','opportunities','activities','products','fitment','aftermarket','master_data','reports'],
    array['read']);
select pg_temp.grant_perm('marketing', array['leads','aftermarket'], array['create','update','delete']);
select pg_temp.grant_perm('marketing', array['activities'], array['create']);
select pg_temp.grant_perm('marketing', array['activities'], array['update','delete'], 'own');
select pg_temp.grant_perm('marketing', array['leads'], array['import']);
select pg_temp.grant_perm('marketing', array['customers','leads','reports'], array['export']);

select pg_temp.grant_perm('engineering',
    array['customers','contacts','opportunities','activities','rfqs','quotations','service_cases','master_data',
          'products','fitment','dev_projects'],
    array['read']);
select pg_temp.grant_perm('engineering', array['products','fitment','dev_projects'], array['create','update','delete']);
select pg_temp.grant_perm('engineering', array['rfqs'], array['update']);
select pg_temp.grant_perm('engineering', array['activities'], array['create']);
select pg_temp.grant_perm('engineering', array['activities'], array['update'], 'own');
select pg_temp.grant_perm('engineering', array['products'], array['import','export']);

select pg_temp.grant_perm('quality',
    array['customers','contacts','activities','products','fitment','dev_projects','rfqs','master_data','service_cases'],
    array['read']);
select pg_temp.grant_perm('quality', array['service_cases'], array['create','update','delete','export']);
select pg_temp.grant_perm('quality', array['activities'], array['create']);
select pg_temp.grant_perm('quality', array['activities'], array['update'], 'own');

select pg_temp.grant_perm('finance',
    array['customers','contacts','opportunities','rfqs','quotations','products','master_data','reports',
          'erp_documents','erp_integration'],
    array['read']);
select pg_temp.grant_perm('finance', array['quotations'], array['approve']);
select pg_temp.grant_perm('finance', array['quotations','reports'], array['export']);

select pg_temp.grant_perm('read_only',
    array['customers','contacts','leads','opportunities','activities','tasks','products','fitment','rfqs','quotations',
          'dev_projects','aftermarket','service_cases','master_data','reports','erp_documents'],
    array['read']);

-- Product divisions and commercial business models named in the DDC requirements
insert into public.divisions (code, name, name_en, sort_order) values
    ('AUTO', 'ยานยนต์', 'Automotive', 10),
    ('AGRI', 'การเกษตร', 'Agriculture', 20);

insert into public.business_models (code, name, name_en, description, sort_order) values
    ('OEM', 'OEM', 'OEM', 'Original Equipment Manufacturer', 10),
    ('ODM', 'ODM', 'ODM', 'Original Design Manufacturer', 20),
    ('OBM', 'OBM', 'OBM', 'Own Brand Manufacturer', 30),
    ('DEALER', 'ตัวแทนจำหน่าย', 'Dealer', null, 40),
    ('DISTRIBUTOR', 'ผู้กระจายสินค้า', 'Distributor', null, 50),
    ('WHOLESALER', 'ผู้ค้าส่ง', 'Wholesaler', null, 60),
    ('RETAILER', 'ผู้ค้าปลีก', 'Retailer', null, 70),
    ('EXPORT', 'ลูกค้าส่งออก', 'Export Customer', null, 80),
    ('IMPORTER', 'ผู้นำเข้า', 'Importer', null, 90),
    ('INDUSTRIAL', 'ลูกค้าอุตสาหกรรม', 'Industrial Customer', null, 100);

insert into public.option_categories (key, name, name_en) values
    ('customer_lifecycle_status', 'สถานะลูกค้า', 'Customer lifecycle status'),
    ('customer_category', 'ประเภทลูกค้า', 'Customer category'),
    ('sales_channel', 'ช่องทางการขาย', 'Sales channel'),
    ('lead_source', 'แหล่งที่มาของลีด', 'Lead source'),
    ('loss_reason', 'เหตุผลที่ไม่ได้งาน', 'Loss reason'),
    ('activity_type', 'ประเภทกิจกรรม', 'Activity type'),
    ('complaint_category', 'ประเภทข้อร้องเรียน', 'Complaint category'),
    ('department', 'แผนก', 'Department'),
    ('vehicle_type', 'ประเภทยานยนต์', 'Vehicle type'),
    ('equipment_type', 'ประเภทเครื่องจักร', 'Equipment type'),
    ('product_lifecycle_status', 'สถานะสินค้า', 'Product lifecycle status'),
    ('document_type', 'ประเภทเอกสาร', 'Document type');

insert into public.master_options (category, code, name, name_en, sort_order) values
    -- The codes 'active' and 'prospect' are read by the dashboard KPIs
    ('customer_lifecycle_status', 'prospect', 'ลูกค้ามุ่งหวัง', 'Prospect', 10),
    ('customer_lifecycle_status', 'active', 'ใช้งานอยู่', 'Active', 20),
    ('customer_lifecycle_status', 'on_hold', 'พักการติดต่อ', 'On hold', 30),
    ('customer_lifecycle_status', 'inactive', 'ไม่เคลื่อนไหว', 'Inactive', 40),
    ('customer_lifecycle_status', 'lost', 'สูญเสียลูกค้า', 'Lost', 50),
    ('customer_category', 'key_account', 'ลูกค้ารายสำคัญ', 'Key account', 10),
    ('customer_category', 'standard', 'ลูกค้าทั่วไป', 'Standard', 20),
    ('sales_channel', 'direct', 'ขายตรง', 'Direct', 10),
    ('sales_channel', 'distribution', 'ผ่านผู้กระจายสินค้า', 'Distribution', 20),
    ('sales_channel', 'dealer_network', 'เครือข่ายตัวแทน', 'Dealer network', 30),
    ('sales_channel', 'export', 'ส่งออก', 'Export', 40),
    ('sales_channel', 'online', 'ออนไลน์', 'Online', 50),
    ('lead_source', 'exhibition', 'งานแสดงสินค้า', 'Exhibition / trade show', 10),
    ('lead_source', 'referral', 'การแนะนำ', 'Referral', 20),
    ('lead_source', 'website', 'เว็บไซต์', 'Website', 30),
    ('lead_source', 'outbound', 'ติดต่อออกไปเอง', 'Outbound contact', 40),
    ('lead_source', 'existing_customer', 'ลูกค้าเดิม', 'Existing customer', 50),
    ('lead_source', 'other', 'อื่น ๆ', 'Other', 90),
    ('loss_reason', 'price', 'ราคา', 'Price', 10),
    ('loss_reason', 'lead_time', 'ระยะเวลาส่งมอบ', 'Lead time', 20),
    ('loss_reason', 'specification', 'ข้อกำหนดทางเทคนิค', 'Specification', 30),
    ('loss_reason', 'competitor', 'คู่แข่ง', 'Competitor', 40),
    ('loss_reason', 'customer_cancelled', 'ลูกค้ายกเลิก', 'Cancelled by customer', 50),
    ('loss_reason', 'other', 'อื่น ๆ', 'Other', 90),
    ('activity_type', 'onsite_visit', 'เข้าพบลูกค้า', 'Onsite visit', 10),
    ('activity_type', 'dealer_visit', 'เยี่ยมตัวแทนจำหน่าย', 'Dealer visit', 20),
    ('activity_type', 'meeting', 'ประชุมกับลูกค้า', 'Customer meeting', 30),
    ('activity_type', 'phone_call', 'โทรศัพท์', 'Telephone call', 40),
    ('activity_type', 'email', 'อีเมล', 'Email', 50),
    ('activity_type', 'technical_discussion', 'หารือทางเทคนิค', 'Technical discussion', 60),
    ('activity_type', 'exhibition', 'งานนิทรรศการ', 'Exhibition', 70),
    ('activity_type', 'trade_show', 'งานแสดงสินค้า', 'Trade show', 80),
    ('activity_type', 'follow_up', 'ติดตามผล', 'Follow-up', 90),
    ('complaint_category', 'product_quality', 'คุณภาพสินค้า', 'Product quality', 10),
    ('complaint_category', 'delivery', 'การส่งมอบ', 'Delivery', 20),
    ('complaint_category', 'packaging', 'บรรจุภัณฑ์', 'Packaging', 30),
    ('complaint_category', 'documentation', 'เอกสาร', 'Documentation', 40),
    ('complaint_category', 'service', 'การบริการ', 'Service', 50),
    ('complaint_category', 'other', 'อื่น ๆ', 'Other', 90),
    ('department', 'sales', 'ฝ่ายขาย', 'Sales', 10),
    ('department', 'marketing', 'การตลาด', 'Marketing', 20),
    ('department', 'engineering', 'วิศวกรรม', 'Engineering', 30),
    ('department', 'production', 'ฝ่ายผลิต', 'Production', 40),
    ('department', 'quality', 'ประกันคุณภาพ', 'Quality', 50),
    ('department', 'purchasing', 'จัดซื้อ', 'Purchasing', 60),
    ('department', 'finance', 'การเงิน', 'Finance', 70),
    ('vehicle_type', 'motorcycle', 'รถจักรยานยนต์', 'Motorcycle', 10),
    ('vehicle_type', 'automobile', 'รถยนต์', 'Automobile', 20),
    ('vehicle_type', 'other', 'อื่น ๆ', 'Other', 90),
    ('equipment_type', 'sugarcane_harvester', 'รถตัดอ้อย', 'Sugarcane harvester', 10),
    ('equipment_type', 'tractor', 'รถแทรกเตอร์', 'Tractor', 20),
    ('equipment_type', 'other', 'อื่น ๆ', 'Other', 90),
    ('product_lifecycle_status', 'development', 'อยู่ระหว่างพัฒนา', 'In development', 10),
    ('product_lifecycle_status', 'active', 'จำหน่ายอยู่', 'Active', 20),
    ('product_lifecycle_status', 'phase_out', 'ทยอยเลิกจำหน่าย', 'Phase-out', 30),
    ('product_lifecycle_status', 'obsolete', 'เลิกจำหน่าย', 'Obsolete', 40),
    ('document_type', 'customer_drawing', 'แบบจากลูกค้า', 'Customer drawing', 10),
    ('document_type', 'ddc_drawing', 'แบบของ DDC', 'DDC drawing', 20),
    ('document_type', 'specification', 'ข้อกำหนด', 'Specification', 30),
    ('document_type', 'feasibility_study', 'ผลการประเมินความเป็นไปได้', 'Feasibility study', 40),
    ('document_type', 'sample_report', 'รายงานตัวอย่าง', 'Sample report', 50),
    ('document_type', '8d_report', 'รายงาน 8D', '8D report', 60),
    ('document_type', 'ncr', 'NCR', 'NCR', 70),
    ('document_type', 'capa', 'CAPA', 'CAPA', 80),
    ('document_type', 'contract', 'สัญญา', 'Contract', 85),
    ('document_type', 'other', 'อื่น ๆ', 'Other', 90);

-- Product families named in the DDC requirements (categories, types and models are left to DDC)
insert into public.product_hierarchy_nodes (division_id, level, code, name, name_en, sort_order)
select d.id, 'family', v.code, v.name, v.name_en, v.sort_order
from (values
    ('AUTO', 'SPROCKET', 'สเตอร์', 'Sprockets', 10),
    ('AUTO', 'CHAIN', 'โซ่', 'Chains', 20),
    ('AUTO', 'REPLACEMENT', 'อะไหล่ทดแทน', 'Replacement parts', 30),
    ('AGRI', 'BASE_CUTTER_BLADE', 'ใบมีดตัดโคน', 'Base cutter blades', 10),
    ('AGRI', 'CHOPPER_BLADE', 'ใบมีดสับ', 'Chopper blades', 20),
    ('AGRI', 'SPROCKET', 'สเตอร์', 'Sprockets', 30),
    ('AGRI', 'DRIVE_COMPONENT', 'ชิ้นส่วนระบบขับเคลื่อน', 'Drive components', 40)
) as v(division_code, code, name, name_en, sort_order)
join public.divisions d on d.code = v.division_code;

-- Pipelines. Stage codes 'won' and 'lost' keep working with the Atomic CRM deal screens.
insert into public.pipelines (code, name, name_en, is_default, sort_order) values
    ('STANDARD', 'การขายทั่วไป', 'Standard sales', true, 10);

insert into public.pipelines (code, name, name_en, business_model_id, sort_order)
select 'OEM_ODM', 'พัฒนาลูกค้า OEM/ODM', 'OEM/ODM development', null, 20;

insert into public.pipeline_stages (pipeline_id, code, name, name_en, sort_order, probability, stage_type)
select p.id, v.code, v.name, v.name_en, v.sort_order, v.probability, v.stage_type
from (values
    ('STANDARD', 'opportunity', 'โอกาสใหม่', 'New opportunity', 10, 10, 'open'),
    ('STANDARD', 'requirement', 'รวบรวมความต้องการ', 'Requirement', 20, 30, 'open'),
    ('STANDARD', 'proposal-sent', 'เสนอราคาแล้ว', 'Quotation sent', 30, 50, 'open'),
    ('STANDARD', 'in-negociation', 'เจรจาต่อรอง', 'Negotiation', 40, 70, 'open'),
    ('STANDARD', 'won', 'ได้งาน', 'Won', 50, 100, 'won'),
    ('STANDARD', 'lost', 'ไม่ได้งาน', 'Lost', 60, 0, 'lost'),
    ('OEM_ODM', 'inquiry', 'รับคำขอพัฒนา', 'Development inquiry', 10, 10, 'open'),
    ('OEM_ODM', 'feasibility', 'ประเมินความเป็นไปได้', 'Feasibility', 20, 25, 'open'),
    ('OEM_ODM', 'sampling', 'ตัวอย่าง/ต้นแบบ', 'Sampling', 30, 45, 'open'),
    ('OEM_ODM', 'proposal-sent', 'เสนอราคาแล้ว', 'Quotation sent', 40, 60, 'open'),
    ('OEM_ODM', 'in-negociation', 'เจรจาต่อรอง', 'Negotiation', 50, 75, 'open'),
    ('OEM_ODM', 'won', 'ได้งาน', 'Won', 60, 100, 'won'),
    ('OEM_ODM', 'lost', 'ไม่ได้งาน', 'Lost', 70, 0, 'lost')
) as v(pipeline_code, code, name, name_en, sort_order, probability, stage_type)
join public.pipelines p on p.code = v.pipeline_code;

insert into public.app_settings (key, value, description) values
    ('quotation_allow_self_approval', 'false'::jsonb, 'When false, the user who submitted a quotation cannot approve it. Requires DDC confirmation.'),
    ('default_currency', '"THB"'::jsonb, 'Default currency for new quotations and opportunities.');

--
-- ERP integration: disabled, mock connector, proposed contracts.
-- erp_entity_name values are CANDIDATE Dynamics 365 F&O public data entity names.
-- They are UNVERIFIED for the DDC environment and must be checked against the
-- entities actually enabled there before any real synchronization.
--

insert into public.erp_connector_config (id, connector_type, environment_type, environment_url, is_enabled, approval_status, notes)
values (1, 'mock', 'mock', null, false, 'not_requested',
    'Real ERP integration is disabled. The identified ERP host (ddcthailand.operations.dynamics.com) has not been verified or contacted.');

insert into public.erp_entity_configs (entity, label, erp_entity_name, crm_table, direction, system_of_record, allowed_operations, sort_order, decision_note) values
    ('customers', 'Customers', 'CustomersV3', 'companies', 'inbound', 'undecided', '{read}', 10, 'Proposed: ERP owns billing accounts, CRM owns prospects. To be confirmed.'),
    ('contacts', 'Contacts', 'ContactsV2', 'contacts', 'disabled', 'undecided', '{read}', 20, 'To be confirmed.'),
    ('products', 'Products', 'ProductsV2', 'products', 'inbound', 'erp', '{read}', 30, 'Shared product definitions. To be confirmed.'),
    ('released_products', 'Released products', 'ReleasedProductsV2', 'products', 'inbound', 'erp', '{read}', 40, 'Per legal entity item master. To be confirmed.'),
    ('inventory_availability', 'Inventory availability', 'WarehousesOnHandV2', 'erp_inventory_availability', 'inbound', 'erp', '{read}', 50, 'Read-only reference. To be confirmed.'),
    ('price_lists', 'Price lists', 'SalesPriceAgreements', 'erp_price_list_entries', 'inbound', 'erp', '{read}', 60, 'Read-only reference. To be confirmed.'),
    ('quotations', 'Quotations', 'SalesQuotationHeadersV2', 'quotations', 'disabled', 'undecided', '{read}', 70, 'Whether CRM quotations are pushed to the ERP is undecided.'),
    ('sales_orders', 'Sales orders', 'SalesOrderHeadersV2', 'erp_sales_orders', 'inbound', 'erp', '{read}', 80, 'ERP is the expected system of record. To be confirmed.'),
    ('sales_order_lines', 'Sales order lines', 'SalesOrderLines', 'erp_sales_order_lines', 'inbound', 'erp', '{read}', 90, 'To be confirmed.'),
    ('deliveries', 'Deliveries', 'SalesPackingSlipHeadersV2', 'erp_deliveries', 'inbound', 'erp', '{read}', 100, 'To be confirmed.'),
    ('invoices', 'Invoices', 'SalesInvoiceHeadersV2', 'erp_invoices', 'inbound', 'erp', '{read}', 110, 'To be confirmed.');

insert into public.erp_field_mappings (entity, crm_field, erp_field, transform, is_key, notes) values
    ('customers', 'erp_key', 'CustomerAccount', 'trim', true, 'Unique within a legal entity only'),
    ('customers', 'name', 'OrganizationName', 'trim', false, null),
    ('customers', 'tax_identifier', 'TaxExemptNumber', 'trim', false, 'Candidate field, unverified'),
    ('customers', 'phone_number', 'PrimaryContactPhone', 'trim', false, null),
    ('customers', 'email', 'PrimaryContactEmail', 'lower', false, null),
    ('customers', 'address', 'AddressStreet', 'trim', false, null),
    ('customers', 'city', 'AddressCity', 'trim', false, null),
    ('customers', 'zipcode', 'AddressZipCode', 'trim', false, null),
    ('customers', 'country', 'AddressCountryRegionId', 'upper', false, null),
    ('contacts', 'erp_key', 'ContactPersonId', 'trim', true, null),
    ('contacts', 'first_name', 'FirstName', 'trim', false, null),
    ('contacts', 'last_name', 'LastName', 'trim', false, null),
    ('contacts', 'title', 'JobTitle', 'trim', false, 'Candidate field, unverified'),
    ('products', 'erp_key', 'ProductNumber', 'trim', true, null),
    ('products', 'part_number', 'ProductNumber', 'trim', false, null),
    ('products', 'name', 'ProductName', 'trim', false, null),
    ('released_products', 'erp_key', 'ItemNumber', 'trim', true, 'Unique within a legal entity only'),
    ('released_products', 'part_number', 'ItemNumber', 'trim', false, null),
    ('released_products', 'name', 'SearchName', 'trim', false, 'Candidate field, unverified'),
    ('released_products', 'uom', 'SalesUnitSymbol', 'trim', false, null),
    ('inventory_availability', 'erp_key', 'ItemNumber', 'trim', true, 'Combined with site and warehouse'),
    ('inventory_availability', 'erp_item_number', 'ItemNumber', 'trim', false, null),
    ('inventory_availability', 'site_id', 'InventorySiteId', 'trim', true, 'Part of the key'),
    ('inventory_availability', 'warehouse_id', 'InventoryWarehouseId', 'trim', true, 'Part of the key'),
    ('inventory_availability', 'available_quantity', 'AvailableOnHandQuantity', 'number', false, null),
    ('inventory_availability', 'on_hand_quantity', 'OnHandQuantity', 'number', false, null),
    ('price_lists', 'erp_key', 'RecordId', 'trim', true, 'Candidate key, unverified'),
    ('price_lists', 'erp_item_number', 'ItemNumber', 'trim', false, null),
    ('price_lists', 'price_group', 'PriceCustomerGroupCode', 'trim', false, null),
    ('price_lists', 'currency', 'PriceCurrencyCode', 'upper', false, null),
    ('price_lists', 'unit_price', 'Price', 'number', false, null),
    ('price_lists', 'quantity_from', 'FromQuantity', 'number', false, null),
    ('price_lists', 'valid_from', 'PriceApplicableFromDate', 'date', false, null),
    ('price_lists', 'valid_to', 'PriceApplicableToDate', 'date', false, null),
    ('quotations', 'erp_key', 'SalesQuotationNumber', 'trim', true, null),
    ('sales_orders', 'erp_key', 'SalesOrderNumber', 'trim', true, 'Unique within a legal entity only'),
    ('sales_orders', 'sales_order_number', 'SalesOrderNumber', 'trim', false, null),
    ('sales_orders', 'erp_customer_account', 'OrderingCustomerAccountNumber', 'trim', false, null),
    ('sales_orders', 'order_date', 'OrderCreationDateTime', 'date', false, 'Candidate field, unverified'),
    ('sales_orders', 'requested_ship_date', 'RequestedShippingDate', 'date', false, null),
    ('sales_orders', 'status', 'SalesOrderStatus', 'trim', false, null),
    ('sales_orders', 'currency', 'CurrencyCode', 'upper', false, null),
    ('sales_orders', 'total_amount', 'OrderTotalAmount', 'number', false, 'Candidate field, unverified'),
    ('sales_order_lines', 'erp_key', 'InventoryLotId', 'trim', true, 'Candidate key, unverified'),
    ('sales_order_lines', 'sales_order_number', 'SalesOrderNumber', 'trim', false, null),
    ('sales_order_lines', 'line_number', 'LineNumber', 'number', false, null),
    ('sales_order_lines', 'erp_item_number', 'ItemNumber', 'trim', false, null),
    ('sales_order_lines', 'quantity', 'OrderedSalesQuantity', 'number', false, null),
    ('sales_order_lines', 'uom', 'SalesUnitSymbol', 'trim', false, null),
    ('sales_order_lines', 'unit_price', 'SalesPrice', 'number', false, null),
    ('sales_order_lines', 'line_amount', 'LineAmount', 'number', false, null),
    ('deliveries', 'erp_key', 'PackingSlipNumber', 'trim', true, 'Candidate key, unverified'),
    ('deliveries', 'delivery_number', 'PackingSlipNumber', 'trim', false, null),
    ('deliveries', 'sales_order_number', 'SalesOrderNumber', 'trim', false, null),
    ('deliveries', 'delivery_date', 'DeliveryDate', 'date', false, null),
    ('invoices', 'erp_key', 'InvoiceNumber', 'trim', true, 'Unique within a legal entity only'),
    ('invoices', 'invoice_number', 'InvoiceNumber', 'trim', false, null),
    ('invoices', 'sales_order_number', 'SalesOrderNumber', 'trim', false, null),
    ('invoices', 'erp_customer_account', 'InvoiceCustomerAccountNumber', 'trim', false, null),
    ('invoices', 'invoice_date', 'InvoiceDate', 'date', false, null),
    ('invoices', 'due_date', 'PaymentDueDate', 'date', false, 'Candidate field, unverified'),
    ('invoices', 'currency', 'CurrencyCode', 'upper', false, null),
    ('invoices', 'invoice_amount', 'TotalInvoiceAmount', 'number', false, null);
