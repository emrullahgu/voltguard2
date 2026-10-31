import React from 'react';
import { View, Text, ActivityIndicator, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { colors, brand } from '../theme';
import { RootStackParamList, TabParamList, AuthStackParamList } from '../types';
import { useAuth } from '../context/AuthContext';

export const navigationRef = createNavigationContainerRef<any>();

import HomeScreen from '../screens/HomeScreen';
import WorkOrdersScreen from '../screens/WorkOrdersScreen';
import NewServiceScreen from '../screens/NewServiceScreen';
import NewWorkOrderScreen from '../screens/NewWorkOrderScreen';
import MessagesScreen from '../screens/MessagesScreen';
import TodoScreen from '../screens/TodoScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';
import ApolloLeadsScreen from '../screens/ApolloLeadsScreen';
import ServicesScreen from '../screens/ServicesScreen';
import ManagerScreen from '../screens/ManagerScreen';
import CompanyScreen from '../screens/CompanyScreen';
import ExpensesScreen from '../screens/ExpensesScreen';
import QuotesScreen from '../screens/QuotesScreen';
import NewQuoteScreen from '../screens/NewQuoteScreen';
import QuoteDetailScreen from '../screens/QuoteDetailScreen';
import CustomersScreen from '../screens/CustomersScreen';
import GlobalSearchScreen from '../screens/GlobalSearchScreen';
import CustomerFormScreen from '../screens/CustomerFormScreen';
import MapScreen from '../screens/MapScreen';
import ShiftScreen from '../screens/ShiftScreen';
import EmployeeDetailScreen from '../screens/EmployeeDetailScreen';
import EmployeeDirectoryScreen from '../screens/EmployeeDirectoryScreen';
import LocationHistoryScreen from '../screens/LocationHistoryScreen';
import GeofencesScreen from '../screens/GeofencesScreen';
import CheckinScannerScreen from '../screens/CheckinScannerScreen';
import NfcCheckinScreen from '../screens/NfcCheckinScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import WorkOrderDetailScreen from '../screens/WorkOrderDetailScreen';
import BulkAssignScreen from '../screens/BulkAssignScreen';
import RecurringTasksScreen from '../screens/RecurringTasksScreen';
import QuoteRevisionsScreen from '../screens/QuoteRevisionsScreen';
import QuoteAcceptScreen from '../screens/QuoteAcceptScreen';
import QuoteTemplatesScreen from '../screens/QuoteTemplatesScreen';
import CustomerSitesScreen from '../screens/CustomerSitesScreen';
import CustomerDocumentsScreen from '../screens/CustomerDocumentsScreen';
import CustomerHistoryScreen from '../screens/CustomerHistoryScreen';
import JobRatingScreen from '../screens/JobRatingScreen';
import CustomerPortalScreen from '../screens/CustomerPortalScreen';
import FormTemplatesScreen from '../screens/FormTemplatesScreen';
import FormBuilderScreen from '../screens/FormBuilderScreen';
import FormFillScreen from '../screens/FormFillScreen';
import FormResponseDetailScreen from '../screens/FormResponseDetailScreen';
import WorkOrderFormsScreen from '../screens/WorkOrderFormsScreen';
import MaterialsScreen from '../screens/MaterialsScreen';
import MaterialFormScreen from '../screens/MaterialFormScreen';
import WarehousesScreen from '../screens/WarehousesScreen';
import WarehouseFormScreen from '../screens/WarehouseFormScreen';
import WarehouseDetailScreen from '../screens/WarehouseDetailScreen';
import StockScreen from '../screens/StockScreen';
import StockMovementScreen from '../screens/StockMovementScreen';
import StockMovementsScreen from '../screens/StockMovementsScreen';
import AssignmentsScreen from '../screens/AssignmentsScreen';
import BarcodeScanScreen from '../screens/BarcodeScanScreen';
import VehiclesScreen from '../screens/VehiclesScreen';
import VehicleFormScreen from '../screens/VehicleFormScreen';
import VehicleDetailScreen from '../screens/VehicleDetailScreen';
import VehicleLogFormScreen from '../screens/VehicleLogFormScreen';
import VehicleLogsScreen from '../screens/VehicleLogsScreen';
import VehicleDamagesScreen from '../screens/VehicleDamagesScreen';
import VehicleDamageFormScreen from '../screens/VehicleDamageFormScreen';
import VehicleRouteScreen from '../screens/VehicleRouteScreen';
import ReportsScreen from '../screens/ReportsScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';
import DashboardScreen from '../screens/DashboardScreen';
import SlaScreen from '../screens/SlaScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import NotificationPreferencesScreen from '../screens/NotificationPreferencesScreen';
import NotificationHubScreen from '../screens/NotificationHubScreen';
import NotificationStatsScreen from '../screens/NotificationStatsScreen';
import BroadcastMessageScreen from '../screens/BroadcastMessageScreen';
import PaymentsScreen from '../screens/PaymentsScreen';
import PaymentFormScreen from '../screens/PaymentFormScreen';
import PaymentDetailScreen from '../screens/PaymentDetailScreen';
import CustomerBalancesScreen from '../screens/CustomerBalancesScreen';
import CashRegisterScreen from '../screens/CashRegisterScreen';
import FinanceHubScreen from '../screens/FinanceHubScreen';
import IncomeReportScreen from '../screens/IncomeReportScreen';
import AgingReportScreen from '../screens/AgingReportScreen';
import EInvoiceScreen from '../screens/EInvoiceScreen';
import AssetsScreen from '../screens/AssetsScreen';
import AssetFormScreen from '../screens/AssetFormScreen';
import AssetDetailScreen from '../screens/AssetDetailScreen';
import EnergyReadingFormScreen from '../screens/EnergyReadingFormScreen';
import MaintenancePlansScreen from '../screens/MaintenancePlansScreen';
import InspectionsScreen from '../screens/InspectionsScreen';
import InspectionFormScreen from '../screens/InspectionFormScreen';
import NonconformitiesScreen from '../screens/NonconformitiesScreen';
import SectorHubScreen from '../screens/SectorHubScreen';
import AssetHistoryScreen from '../screens/AssetHistoryScreen';
import SalesVisitsScreen from '../screens/SalesVisitsScreen';
import SalesVisitFormScreen from '../screens/SalesVisitFormScreen';
import AiHubScreen from '../screens/AiHubScreen';
import AiSettingsScreen from '../screens/AiSettingsScreen';
import AiAssistantScreen from '../screens/AiAssistantScreen';
import VisionScannerScreen from '../screens/VisionScannerScreen';
import VoiceNoteScreen from '../screens/VoiceNoteScreen';
import AiInsightsScreen from '../screens/AiInsightsScreen';
import AdminShiftDashboardScreen from '../screens/AdminShiftDashboardScreen';
import ShiftHistoryScreen from '../screens/ShiftHistoryScreen';
import ManagerCommandCenterScreen from '../screens/ManagerCommandCenterScreen';
import SmartPozSuggestScreen from '../screens/SmartPozSuggestScreen';
import PhotoAnalysisScreen from '../screens/PhotoAnalysisScreen';
import VoiceReportScreen from '../screens/VoiceReportScreen';
import RouteOptimizerScreen from '../screens/RouteOptimizerScreen';
import AnomaliesScreen from '../screens/AnomaliesScreen';
import WebAdminScreen from '../screens/WebAdminScreen';
import UsersAdminScreen from '../screens/UsersAdminScreen';
import UserApprovalsScreen from '../screens/UserApprovalsScreen';
import AllUsersScreen from '../screens/AllUsersScreen';
import ExternalApiKeysScreen from '../screens/ExternalApiKeysScreen';
import ScheduledEmailsScreen from '../screens/ScheduledEmailsScreen';
import LiveTrackingScreen from '../screens/LiveTrackingScreen';
import IntegrationsHubScreen from '../screens/IntegrationsHubScreen';
import ParasutSettingsScreen from '../screens/ParasutSettingsScreen';
import ApiKeysScreen from '../screens/ApiKeysScreen';
import WebhooksScreen from '../screens/WebhooksScreen';
import ExcelImportScreen from '../screens/ExcelImportScreen';
import ErpAdaptersScreen from '../screens/ErpAdaptersScreen';
import KvkkScreen from '../screens/KvkkScreen';
import BackupScreen from '../screens/BackupScreen';
import TwoFactorScreen from '../screens/TwoFactorScreen';
import AccessRulesScreen from '../screens/AccessRulesScreen';
// FAZ 17 — Veri Kalıcılığı & Auth
import ConnectivityHubScreen from '../screens/ConnectivityHubScreen';
import AuditLogScreen from '../screens/AuditLogScreen';
import SyncStatusScreen from '../screens/SyncStatusScreen';
import DataMigrationScreen from '../screens/DataMigrationScreen';
import RoleMatrixScreen from '../screens/RoleMatrixScreen';
// FAZ 18 — Konum & Personel Takibi
import PersonnelTrackingHubScreen from '../screens/PersonnelTrackingHubScreen';
import AttendanceReportScreen from '../screens/AttendanceReportScreen';
import MockLocationAlertsScreen from '../screens/MockLocationAlertsScreen';
// FAZ 19 — İş Emri Akışı
import WorkOrderFlowHubScreen from '../screens/WorkOrderFlowHubScreen';
import WorkOrderKanbanScreen from '../screens/WorkOrderKanbanScreen';
import WorkOrderCostDashboardScreen from '../screens/WorkOrderCostDashboardScreen';
import AutoAssignScreen from '../screens/AutoAssignScreen';
// FAZ 20 — Gelişmiş Teklif Sistemi
import QuoteFlowHubScreen from '../screens/QuoteFlowHubScreen';
import QuoteEmailScreen from '../screens/QuoteEmailScreen';
import QuoteShareScreen from '../screens/QuoteShareScreen';
import RecentPozScreen from '../screens/RecentPozScreen';
// FAZ 21 — Müşteri ve Lokasyon Yönetimi
import CustomerHubScreen from '../screens/CustomerHubScreen';
import CustomerRatingsAllScreen from '../screens/CustomerRatingsAllScreen';
import CustomerSitesMapScreen from '../screens/CustomerSitesMapScreen';
// FAZ 22 — Form ve Kontrol Listeleri
import FormHubScreen from '../screens/FormHubScreen';
import FormResponsesScreen from '../screens/FormResponsesScreen';
import FormStatsScreen from '../screens/FormStatsScreen';
// FAZ 23 — Stok, Malzeme ve Zimmet
import StockHubScreen from '../screens/StockHubScreen';
import LowStockAlertsScreen from '../screens/LowStockAlertsScreen';
import StockSummaryScreen from '../screens/StockSummaryScreen';
// FAZ 24 — Araç Takibi
import VehicleHubScreen from '../screens/VehicleHubScreen';
import VehicleAlertsScreen from '../screens/VehicleAlertsScreen';
import VehicleFuelStatsScreen from '../screens/VehicleFuelStatsScreen';
// FAZ 25 — Raporlama ve Dashboard
import ReportingHubScreen from '../screens/ReportingHubScreen';
import KpiOverviewScreen from '../screens/KpiOverviewScreen';
import ReportComparisonScreen from '../screens/ReportComparisonScreen';
// FAZ 32 — Teklif Modülleri / Görev / Akaryakıt / Ürün / OSOS / Bordro
import ProposalsHubScreen from '../screens/ProposalsHubScreen';
import TransformerProposalsScreen from '../screens/TransformerProposalsScreen';
import TransformerProposalFormScreen from '../screens/TransformerProposalFormScreen';
import GesProposalsScreen from '../screens/GesProposalsScreen';
import GesProposalFormScreen from '../screens/GesProposalFormScreen';
import TaskHubScreen from '../screens/TaskHubScreen';
import TasksScreen from '../screens/TasksScreen';
import TaskFormScreen from '../screens/TaskFormScreen';
import TaskKanbanScreen from '../screens/TaskKanbanScreen';
import FuelReportScreen from '../screens/FuelReportScreen';
import InventoryHubScreen from '../screens/InventoryHubScreen';
import ProductCatalogScreen from '../screens/ProductCatalogScreen';
import ProductItemsScreen from '../screens/ProductItemsScreen';
import ProductItemFormScreen from '../screens/ProductItemFormScreen';
import ProductItemDetailScreen from '../screens/ProductItemDetailScreen';
import OsosHubScreen from '../screens/OsosHubScreen';
import OsosReadingsScreen from '../screens/OsosReadingsScreen';
import OsosImportScreen from '../screens/OsosImportScreen';
import OsosAutomationScreen from '../screens/OsosAutomationScreen';
import WeeklyReportsScreen from '../screens/WeeklyReportsScreen';
import WeeklyReportDetailScreen from '../screens/WeeklyReportDetailScreen';
import PayrollHubScreen from '../screens/PayrollHubScreen';
import TimesheetScreen from '../screens/TimesheetScreen';
import PayrollRunsScreen from '../screens/PayrollRunsScreen';
import LeaveRequestsScreen from '../screens/LeaveRequestsScreen';
import PayrollDetailScreen from '../screens/PayrollDetailScreen';
// FAZ 33 — Auth ek akışlar, Profil, Görev detay, Analitik, Takvim
import ProfileScreen from '../screens/ProfileScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import TaskAnalyticsScreen from '../screens/TaskAnalyticsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import CalendarEventFormScreen from '../screens/CalendarEventFormScreen';
import CalendarEventDetailScreen from '../screens/CalendarEventDetailScreen';
import ChatbotFAB from '../components/ChatbotFAB';
import GlobalToast from '../components/GlobalToast';
// FAZ 34 — Kalite, Test ve Yayına Hazırlık
import QualityHubScreen from '../screens/QualityHubScreen';
import CrashReportsScreen from '../screens/CrashReportsScreen';
import CrashReportDetailScreen from '../screens/CrashReportDetailScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import FeedbackFormScreen from '../screens/FeedbackFormScreen';
import FeedbackDetailScreen from '../screens/FeedbackDetailScreen';
import ReleaseNotesScreen from '../screens/ReleaseNotesScreen';
import PerformanceMetricsScreen from '../screens/PerformanceMetricsScreen';
import EnvironmentInfoScreen from '../screens/EnvironmentInfoScreen';
import TestPlanScreen from '../screens/TestPlanScreen';
// FAZ 35 — Yetkilendirme & Denetim
import GovernanceHubScreen from '../screens/GovernanceHubScreen';
import RoleMatrixV2Screen from '../screens/RoleMatrixV2Screen';
import DepartmentsScreen from '../screens/DepartmentsScreen';
import DepartmentFormScreen from '../screens/DepartmentFormScreen';
import RegionsScreen from '../screens/RegionsScreen';
import RegionFormScreen from '../screens/RegionFormScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import ApprovalDetailScreen from '../screens/ApprovalDetailScreen';
import AuditLogV2Screen from '../screens/AuditLogV2Screen';
import AuditDetailScreen from '../screens/AuditDetailScreen';
import SessionLogsScreen from '../screens/SessionLogsScreen';
import SuspiciousLoginsScreen from '../screens/SuspiciousLoginsScreen';
import KvkkAccessLogsScreen from '../screens/KvkkAccessLogsScreen';
// FAZ 36 — Mobil Saha & Offline
import FieldHubScreen from '../screens/FieldHubScreen';
import OfflineQueueScreen from '../screens/OfflineQueueScreen';
import OfflineOpDetailScreen from '../screens/OfflineOpDetailScreen';
import ConflictResolverScreen from '../screens/ConflictResolverScreen';
import SyncHistoryScreen from '../screens/SyncHistoryScreen';
import FieldFavoritesScreen from '../screens/FieldFavoritesScreen';
import FieldSettingsScreen from '../screens/FieldSettingsScreen';
import AppUpdateScreen from '../screens/AppUpdateScreen';
import ConnectivityMonitorScreen from '../screens/ConnectivityMonitorScreen';
// FAZ 37 — Müşteri Deneyimi & Dış Paylaşım
import CustomerExperienceHubScreen from '../screens/CustomerExperienceHubScreen';
import PortalUsersScreen from '../screens/PortalUsersScreen';
import PortalUserFormScreen from '../screens/PortalUserFormScreen';
import ShareLinksScreen from '../screens/ShareLinksScreen';
import ShareLinkFormScreen from '../screens/ShareLinkFormScreen';
import ShareLinkDetailScreen from '../screens/ShareLinkDetailScreen';
import QuoteApprovalsScreen from '../screens/QuoteApprovalsScreen';
import CustomerCommentsScreen from '../screens/CustomerCommentsScreen';
import SatisfactionSurveysScreen from '../screens/SatisfactionSurveysScreen';
import SurveyDetailScreen from '../screens/SurveyDetailScreen';
import CustomerNotificationPrefsScreen from '../screens/CustomerNotificationPrefsScreen';
import AutoReportsScreen from '../screens/AutoReportsScreen';
import AutoReportFormScreen from '../screens/AutoReportFormScreen';
import BiHubScreen from '../screens/BiHubScreen';
import ExecutiveDashboardScreen from '../screens/ExecutiveDashboardScreen';
import DepartmentKpisScreen from '../screens/DepartmentKpisScreen';
import StaffPerformanceScreen from '../screens/StaffPerformanceScreen';
import VehicleCostAnalysisScreen from '../screens/VehicleCostAnalysisScreen';
import FuelConsumptionScreen from '../screens/FuelConsumptionScreen';
import StockConsumptionScreen from '../screens/StockConsumptionScreen';
import QuoteWinLossScreen from '../screens/QuoteWinLossScreen';
import CustomerProfitabilityScreen from '../screens/CustomerProfitabilityScreen';
import SlaTrackingScreen from '../screens/SlaTrackingScreen';
import RegionHeatmapScreen from '../screens/RegionHeatmapScreen';
import BudgetVsActualScreen from '../screens/BudgetVsActualScreen';
import ExecutiveSummaryScreen from '../screens/ExecutiveSummaryScreen';
import PivotExportScreen from '../screens/PivotExportScreen';
import EnterpriseIntegrationsHubScreen from '../screens/EnterpriseIntegrationsHubScreen';
import ErpConnectionsScreen from '../screens/ErpConnectionsScreen';
import ErpConnectionFormScreen from '../screens/ErpConnectionFormScreen';
import ErpSyncJobsScreen from '../screens/ErpSyncJobsScreen';
import ErpCustomersScreen from '../screens/ErpCustomersScreen';
import ErpStockScreen from '../screens/ErpStockScreen';
import ErpInvoiceDraftsScreen from '../screens/ErpInvoiceDraftsScreen';
import QuoteToOrderScreen from '../screens/QuoteToOrderScreen';
import CrmConnectionsScreen from '../screens/CrmConnectionsScreen';
import IntegrationWebhooksScreen from '../screens/IntegrationWebhooksScreen';
import IntegrationWebhookFormScreen from '../screens/IntegrationWebhookFormScreen';
import IntegrationWebhookDeliveriesScreen from '../screens/IntegrationWebhookDeliveriesScreen';
import IntegrationApiKeysScreen from '../screens/IntegrationApiKeysScreen';
import ApiUsageLogsScreen from '../screens/ApiUsageLogsScreen';
import IntegrationErrorsScreen from '../screens/IntegrationErrorsScreen';
import IntegrationHealthScreen from '../screens/IntegrationHealthScreen';
import PlatformHubScreen from '../screens/PlatformHubScreen';
import TenantsScreen from '../screens/TenantsScreen';
import TenantFormScreen from '../screens/TenantFormScreen';
import TenantMembersScreen from '../screens/TenantMembersScreen';
import TenantSettingsScreen from '../screens/TenantSettingsScreen';
import ModulesScreen from '../screens/ModulesScreen';
import PackagesScreen from '../screens/PackagesScreen';
import LicensesScreen from '../screens/LicensesScreen';
import UsageLimitsScreen from '../screens/UsageLimitsScreen';
import DbIndexHintsScreen from '../screens/DbIndexHintsScreen';
import ArchivePoliciesScreen from '../screens/ArchivePoliciesScreen';
import ArchiveJobsScreen from '../screens/ArchiveJobsScreen';
import BackupsScreen from '../screens/BackupsScreen';
import RestoreTestsScreen from '../screens/RestoreTestsScreen';
import SystemHealthScreen from '../screens/SystemHealthScreen';
import MaintenanceModeScreen from '../screens/MaintenanceModeScreen';
import AiAssistantHubScreen from '../screens/AiAssistantHubScreen';
import AgentConsoleScreen from '../screens/AgentConsoleScreen';
import AgentSuggestionsScreen from '../screens/AgentSuggestionsScreen';
import AiPermissionsScreen from '../screens/AiPermissionsScreen';
import AiSessionsScreen from '../screens/AiSessionsScreen';
import AiChatScreen from '../screens/AiChatScreen';
import CoPilotScreen from '../screens/CoPilotScreen';
import AiKnowledgeBaseScreen from '../screens/AiKnowledgeBaseScreen';
import AiPozSuggestScreen from '../screens/AiPozSuggestScreen';
import AiQuoteDraftScreen from '../screens/AiQuoteDraftScreen';
import AiQuoteDraftDetailScreen from '../screens/AiQuoteDraftDetailScreen';
import AiWorkOrderSummaryScreen from '../screens/AiWorkOrderSummaryScreen';
import AiCustomerInsightScreen from '../screens/AiCustomerInsightScreen';
import AiRiskAlertsScreen from '../screens/AiRiskAlertsScreen';
import AiDailyReportScreen from '../screens/AiDailyReportScreen';
import AiUsageLogsScreen from '../screens/AiUsageLogsScreen';
import FieldOpsHubScreen from '../screens/FieldOpsHubScreen';
import FieldTodayScreen from '../screens/FieldTodayScreen';
import FieldShiftScreen from '../screens/FieldShiftScreen';
import FieldJobsScreen from '../screens/FieldJobsScreen';
import FieldJobDetailScreen from '../screens/FieldJobDetailScreen';
import FieldChecklistScreen from '../screens/FieldChecklistScreen';
import FieldQualityCheckScreen from '../screens/FieldQualityCheckScreen';
import FieldPerformanceScreen from '../screens/FieldPerformanceScreen';
import FieldZonesScreen from '../screens/FieldZonesScreen';
import FieldShiftPlanScreen from '../screens/FieldShiftPlanScreen';
import FieldEmergencyScreen from '../screens/FieldEmergencyScreen';
import FieldCommandCenterScreen from '../screens/FieldCommandCenterScreen';
// Faz 43
import SmartQuoteHubScreen from '../screens/SmartQuoteHubScreen';
import SurveyFormsScreen from '../screens/SurveyFormsScreen';
import SurveyFormDetailScreen from '../screens/SurveyFormDetailScreen';
import PozLibraryScreen from '../screens/PozLibraryScreen';
import PriceListVersionsScreen from '../screens/PriceListVersionsScreen';
import QuoteCalculatorScreen from '../screens/QuoteCalculatorScreen';
import HvTransformerQuoteScreen from '../screens/HvTransformerQuoteScreen';
import PeriodicCheckQuoteScreen from '../screens/PeriodicCheckQuoteScreen';
import GesQuoteScreen from '../screens/GesQuoteScreen';
import CompensationQuoteScreen from '../screens/CompensationQuoteScreen';
import QuoteRevisionCompareScreen from '../screens/QuoteRevisionCompareScreen';
import QuoteOutcomesScreen from '../screens/QuoteOutcomesScreen';
import AiQuoteImprovementsScreen from '../screens/AiQuoteImprovementsScreen';
// Faz 44
import LiveOpsHubScreen from '../screens/LiveOpsHubScreen';
import LiveOpsMapScreen from '../screens/LiveOpsMapScreen';
import JobHeatmapScreen from '../screens/JobHeatmapScreen';
import PersonnelAvailabilityScreen from '../screens/PersonnelAvailabilityScreen';
import SmartRouteSuggestScreen from '../screens/SmartRouteSuggestScreen';
import EtaEstimateScreen from '../screens/EtaEstimateScreen';
import RouteDeviationAlertsScreen from '../screens/RouteDeviationAlertsScreen';
import SiteEventLogsScreen from '../screens/SiteEventLogsScreen';
import TeamPerformanceLayerScreen from '../screens/TeamPerformanceLayerScreen';
import OperationReplayScreen from '../screens/OperationReplayScreen';
// Faz 45
import ComplianceHubScreen from '../screens/ComplianceHubScreen';
import NonConformityScreen from '../screens/NonConformityScreen';
import CapaScreen from '../screens/CapaScreen';
import SafetyChecklistsScreen from '../screens/SafetyChecklistsScreen';
import RiskAssessmentScreen from '../screens/RiskAssessmentScreen';
import AuditScheduleScreen from '../screens/AuditScheduleScreen';
import AuditScoringScreen from '../screens/AuditScoringScreen';
import NcPhotoEvidenceScreen from '../screens/NcPhotoEvidenceScreen';
import NcAssignmentScreen from '../screens/NcAssignmentScreen';
import QualityDashboardScreen from '../screens/QualityDashboardScreen';
import AuditReportScreen from '../screens/AuditReportScreen';
// Faz 46
import AssetHubScreen from '../screens/AssetHubScreen';
import AssetListScreen from '../screens/AssetListScreen';
import AssetQrScreen from '../screens/AssetQrScreen';
import AssetMaintenanceHistoryScreen from '../screens/AssetMaintenanceHistoryScreen';
import AssetFaultHistoryScreen from '../screens/AssetFaultHistoryScreen';
import WarrantyTrackingScreen from '../screens/WarrantyTrackingScreen';
import MaintenancePlanScreen from '../screens/MaintenancePlanScreen';
import MaintenanceAlertsScreen from '../screens/MaintenanceAlertsScreen';
import AssetCostAnalysisScreen from '../screens/AssetCostAnalysisScreen';
import EnergyAssetTypesScreen from '../screens/EnergyAssetTypesScreen';
import ServiceCardScreen from '../screens/ServiceCardScreen';
// Faz 47
import ExecHubScreen from '../screens/ExecHubScreen';
import CeoSummaryScreen from '../screens/CeoSummaryScreen';
import OpsHealthScoreScreen from '../screens/OpsHealthScoreScreen';
import RevenueKpiScreen from '../screens/RevenueKpiScreen';
import ProfitableCustomersScreen from '../screens/ProfitableCustomersScreen';
import CostlyWorkOrdersScreen from '../screens/CostlyWorkOrdersScreen';
import EmployeeRankingScreen from '../screens/EmployeeRankingScreen';
import VehicleEfficiencyScreen from '../screens/VehicleEfficiencyScreen';
import StockTurnoverScreen from '../screens/StockTurnoverScreen';
import QuoteConversionScreen from '../screens/QuoteConversionScreen';
import AiExecSummaryScreen from '../screens/AiExecSummaryScreen';
// Faz 48 — Müşteri Portalı 2.0
import CpHubScreen from '../screens/CpHubScreen';
import CpLoginScreen from '../screens/CpLoginScreen';
import CpDashboardScreen from '../screens/CpDashboardScreen';
import CpQuoteApprovalScreen from '../screens/CpQuoteApprovalScreen';
import CpWorkOrderTrackingScreen from '../screens/CpWorkOrderTrackingScreen';
import CpServiceRequestScreen from '../screens/CpServiceRequestScreen';
import CpDocumentArchiveScreen from '../screens/CpDocumentArchiveScreen';
import CpSatisfactionScreen from '../screens/CpSatisfactionScreen';
import CpNotificationsScreen from '../screens/CpNotificationsScreen';
import CpBrandingScreen from '../screens/CpBrandingScreen';
import CpShareLinkSecurityScreen from '../screens/CpShareLinkSecurityScreen';
// Faz 49 — Güvenlik, KVKK ve Kurumsal Dayanıklılık
import SecHubScreen from '../screens/SecHubScreen';
import SecClassificationScreen from '../screens/SecClassificationScreen';
import KvkkRequestsScreen from '../screens/KvkkRequestsScreen';
import DataExportScreen from '../screens/DataExportScreen';
import DataErasureScreen from '../screens/DataErasureScreen';
import SecDevicesScreen from '../screens/SecDevicesScreen';
import SuspiciousActivityScreen from '../screens/SuspiciousActivityScreen';
import AdminAlertsScreen from '../screens/AdminAlertsScreen';
import BackupReportScreen from '../screens/BackupReportScreen';
import DrPlanScreen from '../screens/DrPlanScreen';
import SecHealthScreen from '../screens/SecHealthScreen';
// Faz 50 — Ürünleşme, SaaS ve Çoklu Firma Altyapısı
import SaasHubScreen from '../screens/SaasHubScreen';
import SaasTenantsScreen from '../screens/SaasTenantsScreen';
import SaasIsolationScreen from '../screens/SaasIsolationScreen';
import SaasModulesScreen from '../screens/SaasModulesScreen';
import SaasPackagesScreen from '../screens/SaasPackagesScreen';
import SaasLicensesScreen from '../screens/SaasLicensesScreen';
import SaasUsageLimitsScreen from '../screens/SaasUsageLimitsScreen';
import SaasBrandingScreen from '../screens/SaasBrandingScreen';
import SaasBillingScreen from '../screens/SaasBillingScreen';
import SaasSuperAdminScreen from '../screens/SaasSuperAdminScreen';
import SaasHealthScreen from '../screens/SaasHealthScreen';
// Faz 51 — Yayına Alma, Derleme ve Platform Kontrolü
import DepHubScreen from '../screens/DepHubScreen';
import DepSupabaseScreen from '../screens/DepSupabaseScreen';
import DepRlsPoliciesScreen from '../screens/DepRlsPoliciesScreen';
import DepStorageScreen from '../screens/DepStorageScreen';
import DepNetlifyScreen from '../screens/DepNetlifyScreen';
import DepBuildErrorsScreen from '../screens/DepBuildErrorsScreen';
import DepAiProvidersScreen from '../screens/DepAiProvidersScreen';
import DepAiSecurityScreen from '../screens/DepAiSecurityScreen';
import DepWebWarningsScreen from '../screens/DepWebWarningsScreen';
import DepMobileWarningsScreen from '../screens/DepMobileWarningsScreen';
import DepApkBuildScreen from '../screens/DepApkBuildScreen';
// Faz 52 — Hata Temizliği, Refactor ve Kod Kalitesi
import QaHubScreen from '../screens/QaHubScreen';
import QaConsoleScreen from '../screens/QaConsoleScreen';
import QaUnusedScreen from '../screens/QaUnusedScreen';
import QaSharedScreen from '../screens/QaSharedScreen';
import QaApiErrorsScreen from '../screens/QaApiErrorsScreen';
import QaUiStatesScreen from '../screens/QaUiStatesScreen';
import QaTypesScreen from '../screens/QaTypesScreen';
import QaModulesScreen from '../screens/QaModulesScreen';
import QaPerformanceScreen from '../screens/QaPerformanceScreen';
import QaQueriesScreen from '../screens/QaQueriesScreen';
import QaReportScreen from '../screens/QaReportScreen';
// Faz 53 — Kabul Testleri
import UatHubScreen from '../screens/UatHubScreen';
import UatAdminScreen from '../screens/UatAdminScreen';
import UatManagerScreen from '../screens/UatManagerScreen';
import UatFieldScreen from '../screens/UatFieldScreen';
import UatCustomerScreen from '../screens/UatCustomerScreen';
import UatQuoteScreen from '../screens/UatQuoteScreen';
import UatWorkOrderScreen from '../screens/UatWorkOrderScreen';
import UatStockScreen from '../screens/UatStockScreen';
import UatLocationScreen from '../screens/UatLocationScreen';
import UatNotificationScreen from '../screens/UatNotificationScreen';
import UatReportScreen from '../screens/UatReportScreen';
// Faz 54 — Dokümantasyon ve Eğitim
import DocHubScreen from '../screens/DocHubScreen';
import DocAdminGuideScreen from '../screens/DocAdminGuideScreen';
import DocManagerGuideScreen from '../screens/DocManagerGuideScreen';
import DocFieldGuideScreen from '../screens/DocFieldGuideScreen';
import DocCustomerGuideScreen from '../screens/DocCustomerGuideScreen';
import DocSupabaseOpsScreen from '../screens/DocSupabaseOpsScreen';
import DocNetlifyOpsScreen from '../screens/DocNetlifyOpsScreen';
import DocApkOpsScreen from '../screens/DocApkOpsScreen';
import DocFaqScreen from '../screens/DocFaqScreen';
import DocTrainingScreen from '../screens/DocTrainingScreen';
import DocChecklistScreen from '../screens/DocChecklistScreen';
// Faz 55 — Canlı Kullanım, İzleme ve Sürekli İyileştirme
import GoLiveHubScreen from '../screens/GoLiveHubScreen';
import GoLiveChecklistScreen from '../screens/GoLiveChecklistScreen';
import GoLiveMonitorScreen from '../screens/GoLiveMonitorScreen';
import GoLiveLogsScreen from '../screens/GoLiveLogsScreen';
import GoLiveFeedbackScreen from '../screens/GoLiveFeedbackScreen';
import GoLiveBugTasksScreen from '../screens/GoLiveBugTasksScreen';
import GoLiveWeeklyScreen from '../screens/GoLiveWeeklyScreen';
import GoLiveMonthlyScreen from '../screens/GoLiveMonthlyScreen';
import GoLiveBacklogScreen from '../screens/GoLiveBacklogScreen';
import GoLiveReleasesScreen from '../screens/GoLiveReleasesScreen';
import GoLiveSupportScreen from '../screens/GoLiveSupportScreen';
import CovHubScreen from '../screens/CovHubScreen';
import CovMatrixScreen from '../screens/CovMatrixScreen';
import CovCategoryScreen from '../screens/CovCategoryScreen';
import CovSummaryScreen from '../screens/CovSummaryScreen';
import ExtHubScreen from '../screens/ExtHubScreen';
import ExtConfigScreen from '../screens/ExtConfigScreen';
import ExtLogsScreen from '../screens/ExtLogsScreen';
import AdvHubScreen from '../screens/AdvHubScreen';
import AdvEcommerceScreen from '../screens/AdvEcommerceScreen';
import AdvCallCenterScreen from '../screens/AdvCallCenterScreen';
import AdvBIScreen from '../screens/AdvBIScreen';
import AdvVoiceAIScreen from '../screens/AdvVoiceAIScreen';
import AdvCollectionForecastScreen from '../screens/AdvCollectionForecastScreen';
import AdvRfmScreen from '../screens/AdvRfmScreen';
import OrdHubScreen from '../screens/OrdHubScreen';
import OrdListScreen from '../screens/OrdListScreen';
import OrdFormScreen from '../screens/OrdFormScreen';
import OrdDetailScreen from '../screens/OrdDetailScreen';
import OrdRecurringScreen from '../screens/OrdRecurringScreen';
import OrdAnalyticsScreen from '../screens/OrdAnalyticsScreen';
// Ofis Takip — Notion benzeri ofis çalışma alanı
import OfficeHubScreen from '../screens/OfficeHubScreen';
import OfficePagesScreen from '../screens/OfficePagesScreen';
import OfficePageScreen from '../screens/OfficePageScreen';
import OfficeBoardsScreen from '../screens/OfficeBoardsScreen';
import OfficeBoardScreen from '../screens/OfficeBoardScreen';
import OfficeMeetingsScreen from '../screens/OfficeMeetingsScreen';
import OfficeMeetingScreen from '../screens/OfficeMeetingScreen';
import BordroScreen from '../screens/BordroScreen';
import UsageScoreScreen from '../screens/UsageScoreScreen';
import { recordUsage, flushUsage, setUsageUser } from '../services/usageTracker';


import { getPendingWrites } from '../portal/api';
import { emitModuleEvent } from '../portal/moduleHostBridge';
const Stack = createNativeStackNavigator<RootStackParamList & TabParamList>();
export const moduleRouteNames: readonly string[] = ["Employees","MainTabs","NewWorkOrder","Messages","Todo","ChatThread","ApolloLeads","Company","Expenses","Services","NewQuote","QuoteDetail","Customers","GlobalSearch","CustomerForm","Map","Shift","EmployeeDetail","LocationHistory","Geofences","CheckinScanner","NfcCheckin","ChangePassword","WorkOrderDetail","BulkAssign","RecurringTasks","QuoteRevisions","QuoteAccept","QuoteTemplates","CustomerSites","CustomerDocuments","CustomerHistory","JobRating","CustomerPortal","FormTemplates","FormBuilder","FormFill","FormResponseDetail","WorkOrderForms","Materials","MaterialForm","Warehouses","WarehouseForm","WarehouseDetail","Stock","StockMovement","StockMovements","Assignments","BarcodeScan","Vehicles","VehicleForm","VehicleDetail","VehicleLogForm","VehicleLogs","VehicleDamages","VehicleDamageForm","VehicleRoute","Reports","ReportDetail","Dashboard","Sla","Notifications","NotificationPreferences","NotificationHub","NotificationStats","BroadcastMessage","Payments","PaymentForm","PaymentDetail","CustomerBalances","CashRegister","FinanceHub","IncomeReport","AgingReport","EInvoice","Assets","AssetForm","AssetDetail","EnergyReadingForm","MaintenancePlans","Inspections","InspectionForm","Nonconformities","SectorHub","AssetHistory","SalesVisits","SalesVisitForm","AiHub","AiAssistant","VisionScanner","VoiceNote","AiInsights","AiSettings","AdminShiftDashboard","ShiftHistory","ManagerCommandCenter","SmartPozSuggest","PhotoAnalysis","VoiceReport","RouteOptimizer","Anomalies","WebAdmin","UsersAdmin","UserApprovals","AllUsers","ExternalApiKeys","ScheduledEmails","LiveTracking","IntegrationsHub","ApiKeys","Webhooks","ExcelImport","ErpAdapters","ParasutSettings","Kvkk","Backup","TwoFactor","AccessRules","ConnectivityHub","AuditLog","SyncStatus","DataMigration","RoleMatrix","PersonnelTrackingHub","AttendanceReport","MockLocationAlerts","WorkOrderFlowHub","WorkOrderKanban","WorkOrderCostDashboard","AutoAssign","QuoteFlowHub","QuoteEmail","QuoteShare","RecentPoz","CustomerHub","CustomerRatingsAll","CustomerSitesMap","FormHub","FormResponses","FormStats","StockHub","LowStockAlerts","StockSummary","VehicleHub","VehicleAlerts","VehicleFuelStats","ReportingHub","KpiOverview","ReportComparison","ProposalsHub","TransformerProposals","TransformerProposalForm","GesProposals","GesProposalForm","TaskHub","Tasks","TaskForm","TaskKanban","OfficeHub","OfficePages","OfficePage","OfficeBoards","OfficeBoard","OfficeMeetings","OfficeMeeting","Bordro","UsageScore","FuelReport","InventoryHub","ProductItems","ProductItemForm","ProductItemDetail","ProductCatalog","OsosHub","OsosReadings","OsosImport","WeeklyReports","WeeklyReportDetail","OsosAutomation","PayrollHub","Timesheet","PayrollRuns","LeaveRequests","PayrollDetail","Profile","TaskDetail","TaskAnalytics","Calendar","CalendarEventForm","CalendarEventDetail","QualityHub","CrashReports","CrashReportDetail","Feedback","FeedbackForm","FeedbackDetail","ReleaseNotes","PerformanceMetrics","EnvironmentInfo","TestPlan","GovernanceHub","RoleMatrixV2","Departments","DepartmentForm","Regions","RegionForm","PermissionsScreen","Approvals","ApprovalDetail","AuditLogV2","AuditDetail","SessionLogs","SuspiciousLogins","KvkkAccessLogs","FieldHub","OfflineQueue","OfflineOpDetail","ConflictResolver","SyncHistory","FieldFavorites","FieldSettings","AppUpdate","ConnectivityMonitor","CustomerExperienceHub","PortalUsers","PortalUserForm","ShareLinks","ShareLinkForm","ShareLinkDetail","QuoteApprovals","CustomerComments","SatisfactionSurveys","SurveyDetail","CustomerNotificationPrefs","AutoReports","AutoReportForm","BiHub","ExecutiveDashboard","DepartmentKpis","StaffPerformance","VehicleCostAnalysis","FuelConsumption","StockConsumption","QuoteWinLoss","CustomerProfitability","SlaTracking","RegionHeatmap","BudgetVsActual","ExecutiveSummary","PivotExport","EnterpriseIntegrationsHub","ErpConnections","ErpConnectionForm","ErpSyncJobs","ErpCustomers","ErpStock","ErpInvoiceDrafts","QuoteToOrder","CrmConnections","IntegrationWebhooks","IntegrationWebhookForm","IntegrationWebhookDeliveries","IntegrationApiKeys","ApiUsageLogs","IntegrationErrors","IntegrationHealth","PlatformHub","Tenants","TenantForm","TenantMembers","TenantSettings","Modules","Packages","Licenses","UsageLimits","DbIndexHints","ArchivePolicies","ArchiveJobs","Backups","RestoreTests","SystemHealth","MaintenanceMode","AiAssistantHub","AgentConsole","AgentSuggestions","AiPermissions","AiSessions","AiChat","CoPilot","AiKnowledgeBase","AiPozSuggest","AiQuoteDraft","AiQuoteDraftDetail","AiWorkOrderSummary","AiCustomerInsight","AiRiskAlerts","AiDailyReport","AiUsageLogs","FieldOpsHub","FieldToday","FieldShift","FieldJobs","FieldJobDetail","FieldChecklist","FieldQualityCheck","FieldPerformance","FieldZones","FieldShiftPlan","FieldEmergency","FieldCommandCenter","SmartQuoteHub","SurveyForms","SurveyFormDetail","PozLibrary","PriceListVersions","QuoteCalculator","HvTransformerQuote","PeriodicCheckQuote","GesQuote","CompensationQuote","QuoteRevisionCompare","QuoteOutcomes","AiQuoteImprovements","LiveOpsHub","LiveOpsMap","JobHeatmap","PersonnelAvailability","SmartRouteSuggest","EtaEstimate","RouteDeviationAlerts","SiteEventLogs","TeamPerformanceLayer","OperationReplay","ComplianceHub","NonConformity","Capa","SafetyChecklists","RiskAssessment","AuditSchedule","AuditScoring","NcPhotoEvidence","NcAssignment","QualityDashboard","AuditReport","AssetHub","AssetList","AssetQr","AssetMaintenanceHistory","AssetFaultHistory","WarrantyTracking","MaintenancePlan","MaintenanceAlerts","AssetCostAnalysis","EnergyAssetTypes","ServiceCard","ExecHub","CeoSummary","OpsHealthScore","RevenueKpi","ProfitableCustomers","CostlyWorkOrders","EmployeeRanking","VehicleEfficiency","StockTurnover","QuoteConversion","AiExecSummary","CpHub","CpLogin","CpDashboard","CpQuoteApproval","CpWorkOrderTracking","CpServiceRequest","CpDocumentArchive","CpSatisfaction","CpNotifications","CpBranding","CpShareLinkSecurity","SecHub","SecClassification","KvkkRequests","DataExport","DataErasure","SecDevices","SuspiciousActivity","AdminAlerts","BackupReport","DrPlan","SecHealth","SaasHub","SaasTenants","SaasIsolation","SaasModules","SaasPackages","SaasLicenses","SaasUsageLimits","SaasBranding","SaasBilling","SaasSuperAdmin","SaasHealth","DepHub","DepSupabase","DepRlsPolicies","DepStorage","DepNetlify","DepBuildErrors","DepAiProviders","DepAiSecurity","DepWebWarnings","DepMobileWarnings","DepApkBuild","QaHub","QaConsole","QaUnused","QaShared","QaApiErrors","QaUiStates","QaTypes","QaModules","QaPerformance","QaQueries","QaReport","UatHub","UatAdmin","UatManager","UatField","UatCustomer","UatQuote","UatWorkOrder","UatStock","UatLocation","UatNotification","UatReport","DocHub","DocAdminGuide","DocManagerGuide","DocFieldGuide","DocCustomerGuide","DocSupabaseOps","DocNetlifyOps","DocApkOps","DocFaq","DocTraining","DocChecklist","GoLiveHub","GoLiveChecklist","GoLiveMonitor","GoLiveLogs","GoLiveFeedback","GoLiveBugTasks","GoLiveWeekly","GoLiveMonthly","GoLiveBacklog","GoLiveReleases","GoLiveSupport","CovHub","CovMatrix","CovCategory","CovSummary","ExtHub","ExtConfig","ExtLogs","AdvHub","AdvEcommerce","AdvCallCenter","AdvBI","AdvVoiceAI","AdvCollectionForecast","AdvRfm","OrdHub","OrdList","OrdForm","OrdDetail","OrdRecurring","OrdAnalytics","WorkOrders","Quotes","Office","NewService","Manager","Home","Explore"];
const aliases: Record<string,string> = { MainTabs:'WorkOrders', Home:'WorkOrders', Explore:'WorkOrders', Dashboard:'KpiOverview', OfficeHub:'Office', HomeDashboard:'KpiOverview' };
export function normalizeModuleRoute(name: string) {
  const route=aliases[name]||name;
  if (!moduleRouteNames.includes(route)) throw new Error('İstenen çalışan modülü bulunamadı.');
  return route;
}
let requestedRoute: {name:string;params?:any}|null = null;
export function setModuleRoute(name: string, params?: any) {
  if (getPendingWrites()>0) throw new Error('Kayıt isteği tamamlandıktan sonra bölüm değiştirebilirsiniz.');
  const route={name:normalizeModuleRoute(name),params};
  if(navigationRef.isReady())navigationRef.resetRoot({index:0,routes:[route]});
  else requestedRoute=route;
}
export function goBackInModule() {
  if(getPendingWrites()>0)throw new Error('Kayıt isteğinin tamamlanmasını bekleyin.');
  if(navigationRef.isReady()&&navigationRef.canGoBack())navigationRef.goBack();
}
function publishRoute() {
  const route=navigationRef.getCurrentRoute();
  if(route){emitModuleEvent('vg:saha-route',{route:normalizeModuleRoute(route.name),params:route.params||{},canGoBack:navigationRef.canGoBack()});recordUsage('screen',route.name).catch(()=>{});}
}
export default function ModuleNavigator({initialRoute='WorkOrders',initialParams}:{initialRoute?:string;initialParams?:any}) {
  const {user,profile}=useAuth();
  React.useEffect(()=>{setUsageUser(profile?.full_name);},[profile?.full_name]);
  React.useEffect(()=>{if(!user?.id)return;recordUsage('session').catch(()=>{});const sub=AppState.addEventListener('change',state=>{if(state!=='active')flushUsage().catch(()=>{});});return()=>{sub.remove();};},[user?.id]);
  const [initialState]=React.useState(()=>({index:0,routes:[{name:normalizeModuleRoute(initialRoute),params:initialParams}]}));
  return <NavigationContainer independent ref={navigationRef} initialState={initialState as any} linking={{enabled:false,prefixes:[]}} documentTitle={{enabled:false}} onStateChange={publishRoute} onReady={()=>{
    if(requestedRoute){const next=requestedRoute;requestedRoute=null;navigationRef.resetRoot({index:0,routes:[next]});}
    publishRoute();emitModuleEvent('vg:saha-ready');
  }}><MainStack initialRoute={initialState.routes[0].name}/><GlobalToast/></NavigationContainer>;
}

function MainStack({ initialRoute }: { initialRoute: string }) {
  return (
    <Stack.Navigator initialRouteName={initialRoute as any} screenOptions={{ headerShown: false, headerTitle: ({ children, tintColor }) => <Text accessibilityRole="header" style={{ fontFamily:'Outfit', fontSize:18, lineHeight:24, fontWeight:'600', color:tintColor || colors.text.primary }}>{children}</Text> }} screenListeners={{ beforeRemove: event => { if (getPendingWrites() > 0) event.preventDefault(); } }}>
      <Stack.Screen name="WorkOrders" component={WorkOrdersScreen} />
      <Stack.Screen name="Quotes" component={QuotesScreen} />
      <Stack.Screen name="Office" component={OfficeHubScreen} />
      <Stack.Screen name="NewService" component={NewServiceScreen} />
      <Stack.Screen name="Manager" component={ManagerScreen} />
      <Stack.Screen name="Employees" component={EmployeeDirectoryScreen} />
      <Stack.Screen name="MainTabs" component={WorkOrdersScreen} />
      <Stack.Screen name="Home" component={WorkOrdersScreen} />
      <Stack.Screen name="Explore" component={WorkOrdersScreen} />
      <Stack.Screen name="NewWorkOrder" component={NewWorkOrderScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Messages" component={MessagesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Todo" component={TodoScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ChatThread" component={ChatThreadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ApolloLeads" component={ApolloLeadsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Company"
        component={CompanyScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Firma Bilgisi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Expenses"
        component={ExpensesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Masraflarım',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Services"
        component={ServicesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Servislerim',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="NewQuote"
        component={NewQuoteScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Yeni Teklif',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="QuoteDetail"
        component={QuoteDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Teklif Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Customers"
        component={CustomersScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteriler',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="GlobalSearch"
        component={GlobalSearchScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerForm"
        component={CustomerFormScreen}
        options={({ route }) => ({
          headerShown: false,
          title: (route.params as any)?.customerId ? 'Müşteri Düzenle' : 'Yeni Müşteri',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Saha Haritası',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Shift"
        component={ShiftScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Mesai',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="EmployeeDetail"
        component={EmployeeDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Personel Detay',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="LocationHistory"
        component={LocationHistoryScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Konum Geçmişi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Geofences"
        component={GeofencesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Bölgeler (Geofence)',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CheckinScanner"
        component={CheckinScannerScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'QR Check-in',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="NfcCheckin"
        component={NfcCheckinScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'NFC Check-in',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Şifre Değiştir',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="WorkOrderDetail"
        component={WorkOrderDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'İş Emri Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="BulkAssign"
        component={BulkAssignScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Toplu Atama',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="RecurringTasks"
        component={RecurringTasksScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Periyodik Görevler',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="QuoteRevisions"
        component={QuoteRevisionsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Revizyon Geçmişi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="QuoteAccept"
        component={QuoteAcceptScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Teklif Kabul',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="QuoteTemplates"
        component={QuoteTemplatesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Teklif Şablonları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CustomerSites"
        component={CustomerSitesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Sahaları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CustomerDocuments"
        component={CustomerDocumentsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Belgeleri',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CustomerHistory"
        component={CustomerHistoryScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Geçmişi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="JobRating"
        component={JobRatingScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Puanı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CustomerPortal"
        component={CustomerPortalScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Portalı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="FormTemplates"
        component={FormTemplatesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Form Şablonları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="FormBuilder"
        component={FormBuilderScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Form Tasarımcısı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="FormFill"
        component={FormFillScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Form Doldur',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="FormResponseDetail"
        component={FormResponseDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Form Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="WorkOrderForms"
        component={WorkOrderFormsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'İş Emri Formları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Materials"
        component={MaterialsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Malzemeler',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="MaterialForm"
        component={MaterialFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Malzeme',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Warehouses"
        component={WarehousesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Depo & Zimmet',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="WarehouseForm"
        component={WarehouseFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Depo / Zimmet',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="WarehouseDetail"
        component={WarehouseDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Detay',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Stock"
        component={StockScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Stok',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="StockMovement"
        component={StockMovementScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Stok Hareketi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="StockMovements"
        component={StockMovementsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Hareket Geçmişi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Assignments"
        component={AssignmentsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Zimmet',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="BarcodeScan"
        component={BarcodeScanScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Barkod Tara',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Vehicles"
        component={VehiclesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araçlar',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleForm"
        component={VehicleFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araç',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleDetail"
        component={VehicleDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araç Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleLogForm"
        component={VehicleLogFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araç Kaydı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleLogs"
        component={VehicleLogsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araç Kayıtları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleDamages"
        component={VehicleDamagesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Araç Hasarları',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleDamageForm"
        component={VehicleDamageFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Hasar',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="VehicleRoute"
        component={VehicleRouteScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Rota Geçmişi',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Raporlar',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="ReportDetail"
        component={ReportDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Rapor Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Dashboard"
        component={KpiOverviewScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Dashboard',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Sla"
        component={SlaScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Geciken İşler',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Bildirimler',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Bildirim Tercihleri',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="NotificationHub"
        component={NotificationHubScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Bildirim & İletişim',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="NotificationStats"
        component={NotificationStatsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Bildirim İstatistik',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="BroadcastMessage"
        component={BroadcastMessageScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Manuel Bildirim',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="Payments"
        component={PaymentsScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Tahsilatlar',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="PaymentForm"
        component={PaymentFormScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Tahsilat',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="PaymentDetail"
        component={PaymentDetailScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Tahsilat Detayı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CustomerBalances"
        component={CustomerBalancesScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Müşteri Bakiyeleri',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="CashRegister"
        component={CashRegisterScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Personel Kasa',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="FinanceHub"
        component={FinanceHubScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Finans & Tahsilat',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="IncomeReport"
        component={IncomeReportScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Gelir Raporu',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="AgingReport"
        component={AgingReportScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'Tahsilat Yaşı',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen
        name="EInvoice"
        component={EInvoiceScreen}
        options={({navigation})=>({
          headerShown: navigation.canGoBack(),
          title: 'E-Fatura',
          headerStyle: { backgroundColor: colors.bg.secondary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { fontWeight: '700' },
        })}
      />
      <Stack.Screen name="Assets" component={AssetsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Cihazlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetForm" component={AssetFormScreen} options={({ route }) => ({ headerShown: false, title: (route.params as any)?.assetId ? 'Cihaz Düzenle' : 'Yeni Cihaz', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetDetail" component={AssetDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Cihaz Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EnergyReadingForm" component={EnergyReadingFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ölçüm Kaydı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="MaintenancePlans" component={MaintenancePlansScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bakım Planları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Inspections" component={InspectionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Denetimler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="InspectionForm" component={InspectionFormScreen} options={({ route }) => ({ headerShown: false, title: (route.params as any)?.inspectionId ? 'Denetim Düzenle' : 'Yeni Denetim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Nonconformities" component={NonconformitiesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Uygunsuzluklar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SectorHub" component={SectorHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sektörel Modüller', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetHistory" component={AssetHistoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Varlık Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SalesVisits" component={SalesVisitsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Satış Ziyaretleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SalesVisitForm" component={SalesVisitFormScreen} options={({ route }) => ({ headerShown: false, title: (route.params as any)?.visitId ? 'Ziyaret Düzenle' : 'Yeni Ziyaret', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiHub" component={AiHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Asistan', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiAssistant" component={AiAssistantScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Asistan (NotebookLM)', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VisionScanner" component={VisionScannerScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Vision Tarayıcı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VoiceNote" component={VoiceNoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ses Notu Asistanı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiInsights" component={AiInsightsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Insights', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiSettings" component={AiSettingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Ayarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdminShiftDashboard" component={AdminShiftDashboardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlı Mesai', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ShiftHistory" component={ShiftHistoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Mesai Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ManagerCommandCenter" component={ManagerCommandCenterScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yönetici Komuta Merkezi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SmartPozSuggest" component={SmartPozSuggestScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Akıllı POZ Önerisi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PhotoAnalysis" component={PhotoAnalysisScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Fotoğraf Analizi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VoiceReport" component={VoiceReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sesli Rapor', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RouteOptimizer" component={RouteOptimizerScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rota Optimizasyonu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Anomalies" component={AnomaliesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Anomali Tespiti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WebAdmin" component={WebAdminScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Web Admin', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UsersAdmin" component={UsersAdminScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanıcılar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UserApprovals" component={UserApprovalsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanıcı Onayları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AllUsers" component={AllUsersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Tüm Kullanıcılar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExternalApiKeys" component={ExternalApiKeysScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Dış Servis API Anahtarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ScheduledEmails" component={ScheduledEmailsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Planlı Rapor Mailleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="LiveTracking" component={LiveTrackingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlı Takip', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationsHub" component={IntegrationsHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Entegrasyon & Güvenlik', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ApiKeys" component={ApiKeysScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'API Anahtarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Webhooks" component={WebhooksScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Webhook', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExcelImport" component={ExcelImportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Excel İçe Aktarma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpAdapters" component={ErpAdaptersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'ERP / CRM', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ParasutSettings" component={ParasutSettingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Paraşüt', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Kvkk" component={KvkkScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'KVKK', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Backup" component={BackupScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yedekleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TwoFactor" component={TwoFactorScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İki Adımlı Doğrulama', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AccessRules" component={AccessRulesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Erişim Kuralları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 17 — Veri Kalıcılığı & Auth */}
      <Stack.Screen name="ConnectivityHub" component={ConnectivityHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri Kalıcılığı & Auth', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditLog" component={AuditLogScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Denetim Kayıtları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SyncStatus" component={SyncStatusScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Senkronizasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DataMigration" component={DataMigrationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri Taşıma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RoleMatrix" component={RoleMatrixScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rol Matrisi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 18 — Konum & Personel Takibi */}
      <Stack.Screen name="PersonnelTrackingHub" component={PersonnelTrackingHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Takibi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AttendanceReport" component={AttendanceReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Puantaj', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="MockLocationAlerts" component={MockLocationAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sahte Konum Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WorkOrderFlowHub" component={WorkOrderFlowHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Emri Akışı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WorkOrderKanban" component={WorkOrderKanbanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kanban', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WorkOrderCostDashboard" component={WorkOrderCostDashboardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Maliyet Panosu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AutoAssign" component={AutoAssignScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Otomatik Atama', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteFlowHub" component={QuoteFlowHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Sistemi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteEmail" component={QuoteEmailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklifi Gönder', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteShare" component={QuoteShareScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Paylaş', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RecentPoz" component={RecentPozScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Son Kullanılan POZ', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerHub" component={CustomerHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Merkezi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerRatingsAll" component={CustomerRatingsAllScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Memnuniyet Puanları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerSitesMap" component={CustomerSitesMapScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Haritası', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FormHub" component={FormHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Form & Kontrol', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FormResponses" component={FormResponsesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Form Yanıtları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FormStats" component={FormStatsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Form İstatistik', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 23 — Stok, Malzeme ve Zimmet */}
      <Stack.Screen name="StockHub" component={StockHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok & Zimmet', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="LowStockAlerts" component={LowStockAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Düşük Stok', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="StockSummary" component={StockSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 24 — Araç Takibi */}
      <Stack.Screen name="VehicleHub" component={VehicleHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Araç & Filo', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VehicleAlerts" component={VehicleAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Vade Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VehicleFuelStats" component={VehicleFuelStatsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yakıt İstatistik', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 25 — Raporlama ve Dashboard */}
      <Stack.Screen name="ReportingHub" component={ReportingHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Raporlama & Dashboard', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="KpiOverview" component={KpiOverviewScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'KPI Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ReportComparison" component={ReportComparisonScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Dönem Karşılaştır', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 32 — Teklif Modülleri / Görev / Akaryakıt / Ürün / OSOS / Bordro */}
      <Stack.Screen name="ProposalsHub" component={ProposalsHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Modülleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TransformerProposals" component={TransformerProposalsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'YG Trafo Teklifleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TransformerProposalForm" component={TransformerProposalFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'YG Trafo Teklifi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GesProposals" component={GesProposalsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'GES Teklifleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GesProposalForm" component={GesProposalFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'GES Teklifi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TaskHub" component={TaskHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Görev Yönetimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Tasks" component={TasksScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Görevler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Görev', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TaskKanban" component={TaskKanbanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kanban', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Ofis Takip — Notion benzeri ofis çalışma alanı */}
      <Stack.Screen name="OfficeHub" component={OfficeHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ofis Takip', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficePages" component={OfficePagesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Çalışma Alanı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficePage" component={OfficePageScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sayfa', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficeBoards" component={OfficeBoardsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Panolar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficeBoard" component={OfficeBoardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Pano', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficeMeetings" component={OfficeMeetingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Toplantılar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfficeMeeting" component={OfficeMeetingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Toplantı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Bordro" component={BordroScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bordro', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UsageScore" component={UsageScoreScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanım & Skor', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FuelReport" component={FuelReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Akaryakıt Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="InventoryHub" component={InventoryHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ürün & Envanter', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ProductItems" component={ProductItemsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ürünler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ProductItemForm" component={ProductItemFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ürün', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ProductItemDetail" component={ProductItemDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ürün Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ProductCatalog" component={ProductCatalogScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ürün Kataloğu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OsosHub" component={OsosHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'OSOS', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OsosReadings" component={OsosReadingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sayaç Okumaları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OsosImport" component={OsosImportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'CSV İçe Aktar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WeeklyReports" component={WeeklyReportsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Haftalık Raporlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WeeklyReportDetail" component={WeeklyReportDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rapor Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OsosAutomation" component={OsosAutomationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'OSOS Otomasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PayrollHub" component={PayrollHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bordro & Puantaj', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Timesheet" component={TimesheetScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Puantaj', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PayrollRuns" component={PayrollRunsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bordrolar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="LeaveRequests" component={LeaveRequestsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PayrollDetail" component={PayrollDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bordro Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 33 — Auth, Profil, Görev detay, Analitik, Takvim */}
      <Stack.Screen name="Profile" component={ProfileScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Profil', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Görev Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TaskAnalytics" component={TaskAnalyticsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Görev Analitik', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Takvim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CalendarEventForm" component={CalendarEventFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Etkinlik', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CalendarEventDetail" component={CalendarEventDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Etkinlik Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 34 — Kalite */}
      <Stack.Screen name="QualityHub" component={QualityHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kalite & Yayın', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CrashReports" component={CrashReportsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Crash Raporları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CrashReportDetail" component={CrashReportDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Crash Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Geri Bildirim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FeedbackForm" component={FeedbackFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yeni Geri Bildirim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FeedbackDetail" component={FeedbackDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Geri Bildirim Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ReleaseNotes" component={ReleaseNotesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sürüm Notları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PerformanceMetrics" component={PerformanceMetricsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Performans', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EnvironmentInfo" component={EnvironmentInfoScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ortam Bilgisi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TestPlan" component={TestPlanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Test Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 35 — Yetkilendirme & Denetim */}
      <Stack.Screen name="GovernanceHub" component={GovernanceHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yetkilendirme & Denetim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RoleMatrixV2" component={RoleMatrixV2Screen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rol & İzin Matrisi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Departments" component={DepartmentsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Departmanlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepartmentForm" component={DepartmentFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Departman', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Regions" component={RegionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bölgeler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RegionForm" component={RegionFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bölge', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PermissionsScreen" component={PermissionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ekran İzinleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Onay Akışları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ApprovalDetail" component={ApprovalDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Onay Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditLogV2" component={AuditLogV2Screen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Audit Log', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditDetail" component={AuditDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Audit Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SessionLogs" component={SessionLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Oturum Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SuspiciousLogins" component={SuspiciousLoginsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Şüpheli Girişler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="KvkkAccessLogs" component={KvkkAccessLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'KVKK Erişim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 36 — Mobil Saha & Offline */}
      <Stack.Screen name="FieldHub" component={FieldHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Mobil Saha', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfflineQueue" component={OfflineQueueScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Offline Kuyruk', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OfflineOpDetail" component={OfflineOpDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İşlem Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ConflictResolver" component={ConflictResolverScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Çakışma Çöz', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SyncHistory" component={SyncHistoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Senkron Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldFavorites" component={FieldFavoritesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Favoriler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldSettings" component={FieldSettingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Ayarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AppUpdate" component={AppUpdateScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Uygulama Güncelleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ConnectivityMonitor" component={ConnectivityMonitorScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bağlantı Monitörü', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* FAZ 37 — Müşteri Deneyimi & Dış Paylaşım */}
      <Stack.Screen name="CustomerExperienceHub" component={CustomerExperienceHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Deneyimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PortalUsers" component={PortalUsersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Portal Kullanıcıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PortalUserForm" component={PortalUserFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Portal Kullanıcı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ShareLinks" component={ShareLinksScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Paylaşım Linkleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ShareLinkForm" component={ShareLinkFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Link', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ShareLinkDetail" component={ShareLinkDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Link Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteApprovals" component={QuoteApprovalsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Onayları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerComments" component={CustomerCommentsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Yorumları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SatisfactionSurveys" component={SatisfactionSurveysScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Memnuniyet Anketleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SurveyDetail" component={SurveyDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Anket Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerNotificationPrefs" component={CustomerNotificationPrefsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bildirim Tercihleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AutoReports" component={AutoReportsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Otomatik Raporlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AutoReportForm" component={AutoReportFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rapor Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="BiHub" component={BiHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'BI & Karar Destek', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExecutiveDashboard" component={ExecutiveDashboardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yönetici Paneli', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepartmentKpis" component={DepartmentKpisScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Departman KPI', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="StaffPerformance" component={StaffPerformanceScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Personel Performansı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VehicleCostAnalysis" component={VehicleCostAnalysisScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Araç Maliyet', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FuelConsumption" component={FuelConsumptionScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yakıt Tüketimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="StockConsumption" component={StockConsumptionScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok Tüketimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteWinLoss" component={QuoteWinLossScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Kazan/Kayıp', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CustomerProfitability" component={CustomerProfitabilityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Kârlılık', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SlaTracking" component={SlaTrackingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'SLA Takip', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RegionHeatmap" component={RegionHeatmapScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bölge Yoğunluk', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="BudgetVsActual" component={BudgetVsActualScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bütçe vs Fiili', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExecutiveSummary" component={ExecutiveSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yönetim Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PivotExport" component={PivotExportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Pivot/CSV', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EnterpriseIntegrationsHub" component={EnterpriseIntegrationsHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Entegrasyonlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpConnections" component={ErpConnectionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'ERP Bağlantıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpConnectionForm" component={ErpConnectionFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'ERP Bağlantı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpSyncJobs" component={ErpSyncJobsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Senkron Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpCustomers" component={ErpCustomersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Cari Eşleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpStock" component={ErpStockScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok Eşleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ErpInvoiceDrafts" component={ErpInvoiceDraftsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Fatura Taslakları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteToOrder" component={QuoteToOrderScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Tekliften Sipariş', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CrmConnections" component={CrmConnectionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'CRM', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationWebhooks" component={IntegrationWebhooksScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Webhooks', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationWebhookForm" component={IntegrationWebhookFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Webhook Formu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationWebhookDeliveries" component={IntegrationWebhookDeliveriesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Webhook Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationApiKeys" component={IntegrationApiKeysScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'API Anahtarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ApiUsageLogs" component={ApiUsageLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'API Kullanım', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationErrors" component={IntegrationErrorsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Entegrasyon Hataları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="IntegrationHealth" component={IntegrationHealthScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sağlık Durumu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PlatformHub" component={PlatformHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Platform Yönetimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Tenants" component={TenantsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Firmalar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TenantForm" component={TenantFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Firma Formu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TenantMembers" component={TenantMembersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Üyeler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TenantSettings" component={TenantSettingsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Firma Ayarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Modules" component={ModulesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Modüller', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Packages" component={PackagesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Paketler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Licenses" component={LicensesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Lisanslar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UsageLimits" component={UsageLimitsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanım Limitleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DbIndexHints" component={DbIndexHintsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'DB İndeks', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ArchivePolicies" component={ArchivePoliciesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Arşiv Politikaları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ArchiveJobs" component={ArchiveJobsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Arşiv Görevleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Backups" component={BackupsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yedekler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RestoreTests" component={RestoreTestsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Restore Testi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SystemHealth" component={SystemHealthScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sistem Sağlığı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="MaintenanceMode" component={MaintenanceModeScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bakım Modu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiAssistantHub" component={AiAssistantHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Asistan', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AgentConsole" component={AgentConsoleScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Otonom Ajan', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AgentSuggestions" component={AgentSuggestionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sistem Önerileri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiPermissions" component={AiPermissionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Yetkileri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiSessions" component={AiSessionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Sohbetler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiChat" component={AiChatScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Sohbet', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CoPilot" component={CoPilotScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AiKnowledgeBase" component={AiKnowledgeBaseScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AiPozSuggest" component={AiPozSuggestScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'POZ Öneri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiQuoteDraft" component={AiQuoteDraftScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Teklif Taslağı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiQuoteDraftDetail" component={AiQuoteDraftDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Taslak Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiWorkOrderSummary" component={AiWorkOrderSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Emri Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiCustomerInsight" component={AiCustomerInsightScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiRiskAlerts" component={AiRiskAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Risk Analizi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiDailyReport" component={AiDailyReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Günlük Rapor', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiUsageLogs" component={AiUsageLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Kullanım Logları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldOpsHub" component={FieldOpsHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Operasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldToday" component={FieldTodayScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bugün', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldShift" component={FieldShiftScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Mesai', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldJobs" component={FieldJobsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha İşleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldJobDetail" component={FieldJobDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldChecklist" component={FieldChecklistScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Checklist', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldQualityCheck" component={FieldQualityCheckScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kalite Kontrol', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldPerformance" component={FieldPerformanceScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Performans', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldZones" component={FieldZonesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bölgeler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldShiftPlan" component={FieldShiftPlanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Vardiya Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldEmergency" component={FieldEmergencyScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Acil İş', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="FieldCommandCenter" component={FieldCommandCenterScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Komuta Merkezi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SmartQuoteHub" component={SmartQuoteHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Akıllı Teklif', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SurveyForms" component={SurveyFormsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Keşif Formları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SurveyFormDetail" component={SurveyFormDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Keşif Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PozLibrary" component={PozLibraryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'POZ Kütüphanesi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PriceListVersions" component={PriceListVersionsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Fiyat Listeleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteCalculator" component={QuoteCalculatorScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Hesap Motoru', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="HvTransformerQuote" component={HvTransformerQuoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'YG Trafo Teklif', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PeriodicCheckQuote" component={PeriodicCheckQuoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Periyodik Kontrol', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GesQuote" component={GesQuoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'GES Teklif', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CompensationQuote" component={CompensationQuoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kompanzasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteRevisionCompare" component={QuoteRevisionCompareScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Revizyon Karşılaştırma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteOutcomes" component={QuoteOutcomesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Sonuçları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiQuoteImprovements" component={AiQuoteImprovementsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI İyileştirme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="LiveOpsHub" component={LiveOpsHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlı Operasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="LiveOpsMap" component={LiveOpsMapScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlı Harita', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="JobHeatmap" component={JobHeatmapScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Yoğunluk Haritası', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="PersonnelAvailability" component={PersonnelAvailabilityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Personel Durumu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SmartRouteSuggest" component={SmartRouteSuggestScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Akıllı Rota', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EtaEstimate" component={EtaEstimateScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'ETA Hesaplama', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RouteDeviationAlerts" component={RouteDeviationAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Rota Sapma Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SiteEventLogs" component={SiteEventLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Varış/Ayrılış', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="TeamPerformanceLayer" component={TeamPerformanceLayerScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ekip Performans', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OperationReplay" component={OperationReplayScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Gün Replay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ComplianceHub" component={ComplianceHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kalite & Denetim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="NonConformity" component={NonConformityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Uygunsuzluklar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="Capa" component={CapaScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'DÖF/Önleyici Faaliyet', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SafetyChecklists" component={SafetyChecklistsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İSG Kontrol Listeleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RiskAssessment" component={RiskAssessmentScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Risk Değerlendirme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditSchedule" component={AuditScheduleScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Denetim Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditScoring" component={AuditScoringScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Denetim Puanlama', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="NcPhotoEvidence" component={NcPhotoEvidenceScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Fotoğraflı Kanıt', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="NcAssignment" component={NcAssignmentScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sorumlu Atama', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QualityDashboard" component={QualityDashboardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kalite Panosu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AuditReport" component={AuditReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Denetim Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetHub" component={AssetHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Ekipman & Bakım', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetList" component={AssetListScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Varlık Listesi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetQr" component={AssetQrScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'QR Kod', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetMaintenanceHistory" component={AssetMaintenanceHistoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bakım Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetFaultHistory" component={AssetFaultHistoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Arıza Geçmişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="WarrantyTracking" component={WarrantyTrackingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Garanti & Servis', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="MaintenancePlan" component={MaintenancePlanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Periyodik Bakım Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="MaintenanceAlerts" component={MaintenanceAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yaklaşan Bakımlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AssetCostAnalysis" component={AssetCostAnalysisScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Maliyet Analizi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EnergyAssetTypes" component={EnergyAssetTypesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Enerji Ekipman Tipleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ServiceCard" component={ServiceCardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Servis Karnesi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Faz 47 */}
      <Stack.Screen name="ExecHub" component={ExecHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stratejik Dashboard', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CeoSummary" component={CeoSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'CEO Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OpsHealthScore" component={OpsHealthScoreScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Operasyon Sağlık', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="RevenueKpi" component={RevenueKpiScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Gelir & Kâr KPI', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ProfitableCustomers" component={ProfitableCustomersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kârlı Müşteriler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CostlyWorkOrders" component={CostlyWorkOrdersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Maliyetli İş Emirleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="EmployeeRanking" component={EmployeeRankingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Personel Sıralaması', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="VehicleEfficiency" component={VehicleEfficiencyScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Araç Verimliliği', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="StockTurnover" component={StockTurnoverScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok Devir Hızı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QuoteConversion" component={QuoteConversionScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Dönüşümü', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AiExecSummary" component={AiExecSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Yönetici Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpHub" component={CpHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Portalı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpLogin" component={CpLoginScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Girişi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpDashboard" component={CpDashboardScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Dashboard', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpQuoteApproval" component={CpQuoteApprovalScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif Onay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpWorkOrderTracking" component={CpWorkOrderTrackingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Emri Takip', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpServiceRequest" component={CpServiceRequestScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Servis Talebi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpDocumentArchive" component={CpDocumentArchiveScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Belge Arşivi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpSatisfaction" component={CpSatisfactionScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Memnuniyet', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpNotifications" component={CpNotificationsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bildirimler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpBranding" component={CpBrandingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Marka Özelleştirme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CpShareLinkSecurity" component={CpShareLinkSecurityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Paylaşım Güvenliği', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SecHub" component={SecHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Güvenlik & Uyumluluk', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SecClassification" component={SecClassificationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri Sınıflandırma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="KvkkRequests" component={KvkkRequestsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'KVKK Talepleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DataExport" component={DataExportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri Dışa Aktarım', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DataErasure" component={DataErasureScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri Silme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SecDevices" component={SecDevicesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Cihaz Oturumları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SuspiciousActivity" component={SuspiciousActivityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Şüpheli Aktivite', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdminAlerts" component={AdminAlertsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Admin Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="BackupReport" component={BackupReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yedek Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DrPlan" component={DrPlanScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Felaket Kurtarma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SecHealth" component={SecHealthScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Güvenlik Skoru', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasHub" component={SaasHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'SaaS & Çoklu Firma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasTenants" component={SaasTenantsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Firmalar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasIsolation" component={SaasIsolationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Veri İzolasyonu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasModules" component={SaasModulesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Modüller', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasPackages" component={SaasPackagesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Paketler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasLicenses" component={SaasLicensesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Lisanslar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasUsageLimits" component={SaasUsageLimitsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanım Limitleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasBranding" component={SaasBrandingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Marka & Tema', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasBilling" component={SaasBillingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Abonelik & Ödeme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasSuperAdmin" component={SaasSuperAdminScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Süper Admin', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="SaasHealth" component={SaasHealthScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Firma Sağlık', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepHub" component={DepHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yayın & Platform', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepSupabase" component={DepSupabaseScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Şirket sunucusu Yapılandırma', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepRlsPolicies" component={DepRlsPoliciesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'RLS Politikaları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepStorage" component={DepStorageScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Storage Bucket', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepNetlify" component={DepNetlifyScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Netlify Deploy', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepBuildErrors" component={DepBuildErrorsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Derleme Hataları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepAiProviders" component={DepAiProvidersScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Sağlayıcılar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepAiSecurity" component={DepAiSecurityScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'AI Güvenlik & Log', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepWebWarnings" component={DepWebWarningsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Web Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepMobileWarnings" component={DepMobileWarningsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Mobil Uyarıları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DepApkBuild" component={DepApkBuildScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'APK Build & Test', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Faz 52 — Kod Kalitesi & Refactor */}
      <Stack.Screen name="QaHub" component={QaHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kod Kalitesi & Refactor', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaConsole" component={QaConsoleScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Console Log Temizliği', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaUnused" component={QaUnusedScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kullanılmayan Dosyalar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaShared" component={QaSharedScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: "Ortak Component'ler", headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaApiErrors" component={QaApiErrorsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'API Hata Yönetimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaUiStates" component={QaUiStatesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'UI Durum Standartları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaTypes" component={QaTypesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'TypeScript Güçlendirme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaModules" component={QaModulesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Modül Yapısı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaPerformance" component={QaPerformanceScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Render Performansı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaQueries" component={QaQueriesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Şirket sunucusu Sorgu Audit', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="QaReport" component={QaReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kalite Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Faz 53 — Kabul Testleri */}
      <Stack.Screen name="UatHub" component={UatHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kabul Testleri', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatAdmin" component={UatAdminScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Admin Senaryoları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatManager" component={UatManagerScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yönetici Senaryoları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatField" component={UatFieldScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Senaryoları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatCustomer" component={UatCustomerScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Senaryoları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatQuote" component={UatQuoteScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Teklif E2E', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatWorkOrder" component={UatWorkOrderScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İş Emri E2E', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatStock" component={UatStockScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Stok & Zimmet E2E', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatLocation" component={UatLocationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Konum & Rota E2E', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatNotification" component={UatNotificationScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Bildirim Akışları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="UatReport" component={UatReportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Test Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Faz 54 — Dokümantasyon ve Eğitim */}
      <Stack.Screen name="DocHub" component={DocHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Dokümantasyon & Eğitim', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocAdminGuide" component={DocAdminGuideScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Admin Kılavuzu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocManagerGuide" component={DocManagerGuideScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yönetici Kılavuzu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocFieldGuide" component={DocFieldGuideScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Saha Personeli Kılavuzu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocCustomerGuide" component={DocCustomerGuideScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Müşteri Portal Kılavuzu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocSupabaseOps" component={DocSupabaseOpsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Şirket sunucusu Bakım & Yedek', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocNetlifyOps" component={DocNetlifyOpsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Netlify Deploy & Rollback', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocApkOps" component={DocApkOpsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'APK Yayın & Güncelleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocFaq" component={DocFaqScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sık Sorulanlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocTraining" component={DocTrainingScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Eğitim Videoları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="DocChecklist" component={DocChecklistScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yayın Öncesi Kontrol', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      {/* Faz 55 — Canlı Kullanım, İzleme ve Sürekli İyileştirme */}
      <Stack.Screen name="GoLiveHub" component={GoLiveHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlı Kullanım & İzleme', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveChecklist" component={GoLiveChecklistScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Canlıya Alma Listesi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveMonitor" component={GoLiveMonitorScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İzleme Paneli', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveLogs" component={GoLiveLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Hata Logları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveFeedback" component={GoLiveFeedbackScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Geri Bildirimler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveBugTasks" component={GoLiveBugTasksScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Hata → Görev', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveWeekly" component={GoLiveWeeklyScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İlk Hafta Raporu', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveMonthly" component={GoLiveMonthlyScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Aylık Analiz', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveBacklog" component={GoLiveBacklogScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İyileştirme Backlog', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveReleases" component={GoLiveReleasesScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sürüm Planı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="GoLiveSupport" component={GoLiveSupportScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Destek Süreci', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CovHub" component={CovHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sistem Kapsam Denetimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CovMatrix" component={CovMatrixScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kapsam Matrisi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CovCategory" component={CovCategoryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kategori Detayı', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="CovSummary" component={CovSummaryScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Kapsam Özeti', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExtHub" component={ExtHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Dış Entegrasyonlar', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExtConfig" component={ExtConfigScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Entegrasyon Ayarları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="ExtLogs" component={ExtLogsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Entegrasyon Logları', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvHub" component={AdvHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'İleri Analitik & AI', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvEcommerce" component={AdvEcommerceScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'E-Ticaret', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvCallCenter" component={AdvCallCenterScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Çağrı Merkezi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvBI" component={AdvBIScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'BI Veri Köprüsü', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvVoiceAI" component={AdvVoiceAIScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sesli AI', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvCollectionForecast" component={AdvCollectionForecastScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Tahsilat Tahmini', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="AdvRfm" component={AdvRfmScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'RFM Segmentasyon', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdHub" component={OrdHubScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sipariş Yönetimi', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdList" component={OrdListScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Siparişler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdForm" component={OrdFormScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Yeni Sipariş', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdDetail" component={OrdDetailScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sipariş Detay', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdRecurring" component={OrdRecurringScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Tekrarlayan Siparişler', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
      <Stack.Screen name="OrdAnalytics" component={OrdAnalyticsScreen} options={({navigation})=>({ headerShown: navigation.canGoBack(), title: 'Sipariş Analitiği', headerStyle: { backgroundColor: colors.bg.secondary }, headerTintColor: colors.text.primary, headerTitleStyle: { fontWeight: '700' } })} />
    </Stack.Navigator>
  );
}
