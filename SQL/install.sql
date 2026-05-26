-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 20, 2024 at 12:43 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `coinectra`
--

-- --------------------------------------------------------

--
-- Table structure for table `admins`
--

CREATE TABLE `admins` (
  `id` int(11) UNSIGNED NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `username` varchar(50) DEFAULT NULL,
  `email` varchar(191) DEFAULT NULL,
  `password` varchar(191) DEFAULT NULL,
  `two_fa` tinyint(1) NOT NULL DEFAULT 0,
  `two_fa_verify` tinyint(1) NOT NULL DEFAULT 1,
  `two_fa_code` varchar(50) DEFAULT NULL,
  `image` varchar(191) DEFAULT NULL,
  `image_driver` varchar(50) DEFAULT NULL,
  `phone` varchar(191) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `admin_access` text DEFAULT NULL,
  `last_login` varchar(50) DEFAULT NULL,
  `status` tinyint(1) DEFAULT 0,
  `last_seen` datetime DEFAULT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `admins`
--

INSERT INTO `admins` (`id`, `name`, `username`, `email`, `password`, `two_fa`, `two_fa_verify`, `two_fa_code`, `image`, `image_driver`, `phone`, `address`, `admin_access`, `last_login`, `status`, `last_seen`, `remember_token`, `created_at`, `updated_at`) VALUES
(1, 'admin', 'admin', 'ad213min@bug13.com', '$2a$12$7oz7G/6cz8hTSNuiTzefkOwVWk/.6O.Xu85cR.3chaAmzYDApuzU6', 0, 1, 'AYMLTWGFWLTZHL3L', 'adminProfileImage/njDQySmiDmkmWgkYHx4wojvfAw3r2P8c8PdR3dGU.jpg', 'local', '9925698552', '13th Street. 47 W 13th St, New York, NY 10011, USA', NULL, '2024-11-20 11:01:10', 1, '2024-11-20 11:38:35', NULL, NULL, '2024-11-20 05:38:35');

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `announcement_text` text DEFAULT NULL,
  `btn_name` varchar(255) DEFAULT NULL,
  `btn_link` text DEFAULT NULL,
  `btn_display` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=>off,1=>on',
  `status` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=>off,1=>on',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `announcements`
--

INSERT INTO `announcements` (`id`, `announcement_text`, `btn_name`, `btn_link`, `btn_display`, `status`, `created_at`, `updated_at`) VALUES
(1, 'Exchange crypto for a 0% service fee in the app! Exclusive offer for your next exchange.', 'Get in app', 'https://bugfinder.net/', 1, 1, '2024-01-31 12:51:09', '2024-03-31 16:36:00');

-- --------------------------------------------------------

--
-- Table structure for table `basic_controls`
--

CREATE TABLE `basic_controls` (
  `id` int(11) UNSIGNED NOT NULL,
  `theme` varchar(50) DEFAULT NULL,
  `site_title` varchar(191) DEFAULT NULL,
  `primary_color` varchar(50) DEFAULT NULL,
  `secondary_color` varchar(50) DEFAULT NULL,
  `time_zone` varchar(50) DEFAULT NULL,
  `base_currency` varchar(20) DEFAULT NULL,
  `currency_symbol` varchar(20) DEFAULT NULL,
  `admin_prefix` varchar(191) DEFAULT NULL,
  `is_currency_position` varchar(191) NOT NULL DEFAULT 'left' COMMENT 'left, right',
  `has_space_between_currency_and_amount` tinyint(1) NOT NULL DEFAULT 0,
  `is_force_ssl` tinyint(1) NOT NULL DEFAULT 0,
  `is_maintenance_mode` tinyint(1) NOT NULL DEFAULT 0,
  `paginate` int(11) DEFAULT NULL,
  `strong_password` tinyint(1) NOT NULL DEFAULT 0,
  `registration` tinyint(1) NOT NULL DEFAULT 0,
  `fraction_number` int(11) DEFAULT NULL,
  `sender_email` varchar(191) DEFAULT NULL,
  `sender_email_name` varchar(191) DEFAULT NULL,
  `email_description` text DEFAULT NULL,
  `push_notification` tinyint(1) NOT NULL DEFAULT 0,
  `in_app_notification` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 => inactive, 1 => active',
  `email_notification` tinyint(1) NOT NULL DEFAULT 0,
  `email_verification` tinyint(1) NOT NULL DEFAULT 0,
  `sms_notification` tinyint(1) NOT NULL DEFAULT 0,
  `sms_verification` tinyint(1) NOT NULL DEFAULT 0,
  `tawk_id` varchar(191) DEFAULT NULL,
  `tawk_status` tinyint(1) NOT NULL DEFAULT 0,
  `fb_messenger_status` tinyint(1) NOT NULL DEFAULT 0,
  `fb_app_id` varchar(191) DEFAULT NULL,
  `fb_page_id` varchar(191) DEFAULT NULL,
  `manual_recaptcha` tinyint(1) DEFAULT 0 COMMENT '0 =>inactive, 1 => active ',
  `google_recaptcha` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=>inactive, 1 =>active',
  `recaptcha_admin_login` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 => inactive, 1 => active ',
  `google_reCapture_admin_login` tinyint(1) NOT NULL DEFAULT 0,
  `google_reCaptcha_status_login` tinyint(1) NOT NULL DEFAULT 0,
  `google_reCaptcha_status_registration` tinyint(1) NOT NULL DEFAULT 0,
  `reCaptcha_status_login` tinyint(1) DEFAULT 0 COMMENT '0 = inactive, 1 = active',
  `reCaptcha_status_registration` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 = inactive, 1 = active',
  `measurement_id` varchar(191) DEFAULT NULL,
  `analytic_status` tinyint(1) DEFAULT NULL,
  `error_log` tinyint(1) DEFAULT NULL,
  `is_active_cron_notification` tinyint(1) DEFAULT NULL,
  `logo` varchar(255) DEFAULT NULL,
  `logo_driver` varchar(15) DEFAULT NULL,
  `favicon` varchar(255) DEFAULT NULL,
  `favicon_driver` varchar(15) DEFAULT NULL,
  `admin_logo` varchar(255) DEFAULT NULL,
  `admin_logo_driver` varchar(15) DEFAULT NULL,
  `dark_logo` varchar(255) DEFAULT NULL,
  `dark_logo_driver` varchar(15) DEFAULT NULL,
  `admin_dark_mode_logo` varchar(255) DEFAULT NULL,
  `admin_dark_mode_logo_driver` varchar(15) DEFAULT NULL,
  `currency_layer_access_key` varchar(191) DEFAULT NULL,
  `currency_layer_auto_update_at` varchar(191) DEFAULT NULL,
  `currency_layer_auto_update` varchar(1) DEFAULT NULL,
  `coin_market_cap_app_key` varchar(191) DEFAULT NULL,
  `coin_market_cap_auto_update_at` varchar(191) NOT NULL,
  `coin_market_cap_auto_update` tinyint(1) DEFAULT NULL,
  `automatic_payout_permission` tinyint(1) NOT NULL DEFAULT 0,
  `exchange_rate` float NOT NULL DEFAULT 0 COMMENT '1 USD = (rate) base_currency',
  `date_time_format` varchar(191) DEFAULT NULL,
  `floating_rate_update_time` int(11) NOT NULL DEFAULT 0 COMMENT 'in miliseconds',
  `floating_rate_update_status` tinyint(1) NOT NULL DEFAULT 1,
  `crypto_send_time` int(11) DEFAULT 60 COMMENT 'in minutes',
  `fiat_send_time` int(11) NOT NULL DEFAULT 60 COMMENT 'in minutes',
  `default_mode` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=>light,1=>dark',
  `changeable_mode` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `basic_controls`
--

INSERT INTO `basic_controls` (`id`, `theme`, `site_title`, `primary_color`, `secondary_color`, `time_zone`, `base_currency`, `currency_symbol`, `admin_prefix`, `is_currency_position`, `has_space_between_currency_and_amount`, `is_force_ssl`, `is_maintenance_mode`, `paginate`, `strong_password`, `registration`, `fraction_number`, `sender_email`, `sender_email_name`, `email_description`, `push_notification`, `in_app_notification`, `email_notification`, `email_verification`, `sms_notification`, `sms_verification`, `tawk_id`, `tawk_status`, `fb_messenger_status`, `fb_app_id`, `fb_page_id`, `manual_recaptcha`, `google_recaptcha`, `recaptcha_admin_login`, `google_reCapture_admin_login`, `google_reCaptcha_status_login`, `google_reCaptcha_status_registration`, `reCaptcha_status_login`, `reCaptcha_status_registration`, `measurement_id`, `analytic_status`, `error_log`, `is_active_cron_notification`, `logo`, `logo_driver`, `favicon`, `favicon_driver`, `admin_logo`, `admin_logo_driver`, `dark_logo`, `dark_logo_driver`, `admin_dark_mode_logo`, `admin_dark_mode_logo_driver`, `currency_layer_access_key`, `currency_layer_auto_update_at`, `currency_layer_auto_update`, `coin_market_cap_app_key`, `coin_market_cap_auto_update_at`, `coin_market_cap_auto_update`, `automatic_payout_permission`, `exchange_rate`, `date_time_format`, `floating_rate_update_time`, `floating_rate_update_status`, `crypto_send_time`, `fiat_send_time`, `default_mode`, `changeable_mode`, `created_at`, `updated_at`) VALUES
(1, 'light', 'Coinectra', '#5c5cf0', '#000000', 'UTC', 'USD', '$', 'admin', 'left', 0, 0, 0, 20, 0, 1, 2, 'support@you.com', 'Bug Admin', '<p> \r\nHello [[name]],</p><p>\r\n\r\n[[message]]</p>', 0, 0, 1, 0, 0, 0, 'OSLDSF465', 0, 0, 'KLSDKF789', '654646977', 0, 0, 1, 1, 1, 1, 1, 1, 'aaaaaa', 0, 0, 1, 'logo/8JoZrpkenooJnSO71u5TgouLU2YcAZ.webp', 'local', 'logo/ES7dCmSp8WHcdVbDCySZU9JXVhkMOH.webp', 'local', 'logo/eGD66TCSGC53XakLryNj6XTjTPyfoS.webp', 'local', 'logo/iycKeohyBLjKn0A3PK6hrdNAmvtpyE.webp', 'local', 'logo/AZSsWVsaHLAFZAub3UlTklyRC9jGvz.webp', 'local', 'c4d1082c39633125a67a2b9dd979f7ce', 'everyMinute', '0', '4fbdbe08-ea29-4442-84ac-c1777fe3a041', 'everyMinute', 1, 0, 1, 'd/m/Y', 30, 1, 60, 70, 0, 1, '2023-06-14 00:35:41', '2024-11-20 05:19:24');

-- --------------------------------------------------------

--
-- Table structure for table `buy_requests`
--

CREATE TABLE `buy_requests` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `send_currency_id` bigint(20) UNSIGNED NOT NULL,
  `get_currency_id` bigint(20) UNSIGNED NOT NULL,
  `gateway_id` int(11) DEFAULT NULL COMMENT 'which gateway use for payment',
  `send_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `get_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `exchange_rate` decimal(18,8) NOT NULL DEFAULT 1.00000000 COMMENT '1 sendCurrency = buyCurrency',
  `service_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `network_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `final_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'After deduct all fees',
  `destination_wallet` varchar(255) DEFAULT NULL COMMENT 'which address crypto send',
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0=>initiate,1=>give_address,2=>deposit_amount,3=>exchange_completed,4=>time_expired,5=>cancel',
  `utr` varchar(50) DEFAULT NULL,
  `expire_time` timestamp NULL DEFAULT NULL COMMENT 'when payment time over',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `coin_announces`
--

CREATE TABLE `coin_announces` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `heading` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `image` text DEFAULT NULL,
  `driver` varchar(255) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0=>inactive,1=>active',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `coin_announces`
--

INSERT INTO `coin_announces` (`id`, `heading`, `description`, `image`, `driver`, `status`, `created_at`, `updated_at`) VALUES
(1, 'Hottest rates for USDT/BTC, USDT/ETH swaps', '<p>Enjoy a cost-effective way to swap the same stablecoin cross-chain, at a 1:1 exchange rate.</p><p> For example, you can convert <b>USDT-ERC20</b> to<b> USDT-TRC20</b>.</p><p> Please note that network and service fees apply.</p><p><b> Stablecoins participating in the promotion: USDT, USDC, TUSD.</b></p>', 'coinAnnounce/KUWDtctzLCEsP9etbmK9pKJgPPEBUB.webp', 'local', 1, '2024-11-16 14:25:54', '2024-11-16 14:25:54'),
(2, '1:1 rate for stablecoin swaps: same coin, any chain', '<p>Enjoy a cost-effective way to swap the same stablecoin<span>cross-chain, at a </span><span><b>1:1</b></span><span> exchange rate. For example, you can convert USDT-ERC20 to USDT-TRC20.\r\n</span></p><p><span>Please note that network and service fees apply.\r\n</span></p><p><span><b>Stablecoins participating in the promotion:\r\nUSDT, USDC, TUSD.</b></span></p>', 'coinAnnounce/NTphKPkY1d2OUnpL4wHi2UWc0K8sDg.webp', 'local', 1, '2024-11-07 23:11:51', '2024-11-07 23:11:51');

-- --------------------------------------------------------

--
-- Table structure for table `contents`
--

CREATE TABLE `contents` (
  `id` int(11) UNSIGNED NOT NULL,
  `name` varchar(191) DEFAULT NULL,
  `type` varchar(191) DEFAULT NULL,
  `media` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `contents`
--

INSERT INTO `contents` (`id`, `name`, `type`, `media`, `created_at`, `updated_at`) VALUES
(1, 'about', 'single', '{\"image\":{\"path\":\"contents\\/uKdGZKhhVBq3WkEXkSADp0Opybz9Fm.webp\",\"driver\":\"local\"},\"my_link\":\"https:\\/\\/bugfinder.net\\/\"}', '2024-11-16 00:52:14', '2024-11-18 04:17:19'),
(2, 'feature', 'single', '{\"image\":{\"path\":\"contents\\/7XpMqZXQfEOuYCbGtmTVed7ea4fobR.webp\",\"driver\":\"local\"}}', '2024-11-04 01:21:44', '2024-11-18 04:20:40'),
(3, 'feature', 'multiple', '{\"icon\":\"fa-light fa-chart-line-up\"}', '2024-11-11 18:16:30', '2024-11-11 18:16:30'),
(4, 'feature', 'multiple', '{\"icon\":\"fa-light fa-scroll\"}', '2024-11-04 02:14:04', '2024-11-04 02:14:04'),
(5, 'feature', 'multiple', '{\"icon\":\"fa-light fa-piggy-bank\"}', '2024-11-08 06:39:28', '2024-11-08 06:39:28'),
(6, 'feature', 'multiple', '{\"icon\":\"fa-sharp fa-light fa-earth-americas\"}', '2024-11-05 18:04:54', '2024-11-05 18:04:54'),
(7, 'how_it_work', 'single', '{\"image\":{\"path\":\"contents\\/dbJJHrh9YvY2fPBmcuI13EnYeVBsON.avif\",\"driver\":\"local\"}}', '2024-11-06 06:28:19', '2024-11-06 06:28:19'),
(8, 'how_it_work', 'multiple', NULL, '2024-11-05 07:50:20', '2024-11-05 07:50:20'),
(9, 'how_it_work', 'multiple', NULL, '2024-11-08 13:10:24', '2024-11-08 13:10:24'),
(10, 'how_it_work', 'multiple', NULL, '2024-11-08 21:13:24', '2024-11-08 21:13:24'),
(11, 'how_it_work', 'multiple', NULL, '2024-11-08 16:12:35', '2024-11-08 16:12:35'),
(12, 'why_choose_us', 'single', '{\"image\":{\"path\":\"contents\\/cBvS21GRhrMJA80NPGLthYZP26ryDG.webp\",\"driver\":\"local\"}}', '2024-11-10 19:29:23', '2024-11-10 19:29:23'),
(13, 'why_choose_us', 'multiple', '{\"icon\":\"fa-light fa-shield-check\"}', '2024-11-13 11:07:31', '2024-11-13 11:07:31'),
(14, 'why_choose_us', 'multiple', '{\"icon\":\"fa-sharp fa-light fa-earth-americas\"}', '2024-11-08 16:24:35', '2024-11-08 16:24:35'),
(15, 'why_choose_us', 'multiple', '{\"icon\":\"fa-light fa-user-group\"}', '2024-11-01 06:36:57', '2024-11-01 06:36:57'),
(16, 'why_choose_us', 'multiple', '{\"icon\":\"fa-light fa-handshake\"}', '2024-11-09 03:16:51', '2024-11-09 03:16:51'),
(17, 'faq', 'single', '{\"image\":{\"path\":\"contents\\/8bjAOexlVdaQoyzBxLRTXqU3E2ovg5.webp\",\"driver\":\"local\"}}', '2024-11-10 01:14:26', '2024-11-18 04:18:11'),
(18, 'faq', 'multiple', NULL, '2024-11-01 01:39:58', '2024-11-01 01:39:58'),
(19, 'faq', 'multiple', NULL, '2024-11-15 00:47:33', '2024-11-15 00:47:33'),
(20, 'faq', 'multiple', NULL, '2024-11-15 18:40:58', '2024-11-15 18:40:58'),
(21, 'faq', 'multiple', NULL, '2024-11-12 15:16:53', '2024-11-12 15:16:53'),
(22, 'faq', 'multiple', NULL, '2024-11-09 14:28:13', '2024-11-09 14:28:13'),
(23, 'faq', 'multiple', NULL, '2024-11-08 01:23:47', '2024-11-08 01:23:47'),
(24, 'testimonial', 'single', NULL, '2024-11-04 17:10:15', '2024-11-04 17:10:15'),
(28, 'testimonial', 'multiple', '{\"image\":{\"path\":\"contents\\/WJSRnehIJKvenWRDKhkpBWFj0YRE48.avif\",\"driver\":\"local\"}}', '2024-11-12 20:31:07', '2024-11-12 20:31:07'),
(29, 'testimonial', 'multiple', '{\"image\":{\"path\":\"contents\\/agGyHM6uu4CUTZ9XM68GiKTUOGPywJ.avif\",\"driver\":\"local\"}}', '2024-11-15 23:18:13', '2024-11-15 23:18:13'),
(30, 'testimonial', 'multiple', '{\"image\":{\"path\":\"contents\\/6YKNA9H4A3EBt19kahDrdpmICnqj2h.avif\",\"driver\":\"local\"}}', '2024-11-13 12:48:10', '2024-11-13 12:48:10'),
(31, 'testimonial', 'multiple', '{\"image\":{\"path\":\"contents\\/aOqZ538AbI1TDU8gZyfBrxmL1r34pr.avif\",\"driver\":\"local\"}}', '2024-11-10 08:53:17', '2024-11-10 08:53:17'),
(32, 'testimonial', 'multiple', '{\"image\":{\"path\":\"contents\\/0tEVHYkgXIjxziaI0fGC7kb5Lf2FDX.avif\",\"driver\":\"local\"}}', '2024-11-17 11:21:43', '2024-11-17 11:21:43'),
(33, 'blog', 'single', NULL, '2024-11-13 11:41:21', '2024-11-13 11:41:21'),
(35, 'blog', 'multiple', '{\"image\":{\"path\":\"contents\\/SaeGLG8UTrOJLPimXebt5psvGkTXhZ.avif\",\"driver\":\"local\"}}', '2024-11-03 06:48:16', '2024-11-03 06:48:16'),
(36, 'blog', 'multiple', '{\"image\":{\"path\":\"contents\\/CmIOR5kYAznCIVDqUrM4P6XCBJ1JOP.avif\",\"driver\":\"local\"}}', '2024-11-02 07:14:25', '2024-11-02 07:14:25'),
(37, 'blog', 'multiple', '{\"image\":{\"path\":\"contents\\/fRJ74BABUf4071SS3BXTFI3RZ0fHX5.avif\",\"driver\":\"local\"}}', '2024-11-03 17:21:51', '2024-11-03 17:21:51'),
(38, 'blog', 'multiple', '{\"image\":{\"path\":\"contents\\/vAf4LgvZmVaZRSdexq1QARoa1yAoNe.avif\",\"driver\":\"local\"}}', '2024-11-02 20:42:36', '2024-11-02 20:42:36'),
(39, 'subscribe', 'single', '{\"image\":{\"path\":\"contents\\/TGKh7rXt5aBxLPPwaJjjMfbxHsUFJ9.avif\",\"driver\":\"local\"}}', '2024-11-14 05:10:34', '2024-11-14 05:10:34'),
(40, 'contact', 'single', '{\"my_link\":\"https:\\/\\/www.google.com\\/maps\\/embed?pb=!1m18!1m12!1m3!1d193595.15830869428!2d-74.119763973046!3d40.69766374874431!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c24fa5d33f083b%3A0xc80b8f06e177fe62!2sNew%20York%2C%20NY%2C%20USA!5e0!3m2!1sen!2sbd!4v1668508535036!5m2!1sen!2sbd\"}', '2024-11-05 07:55:09', '2024-11-05 07:55:09'),
(41, 'login-register', 'single', '{\"login_page_image\":{\"path\":\"contents\\/l46Q8U4ZlrKq8ySUnOX3rq8ltNYpEB.avif\",\"driver\":\"local\"},\"register_page_image\":{\"path\":\"contents\\/FwCjtUSxmH4IMsZUvgszaeuIS1QnAq.avif\",\"driver\":\"local\"},\"verify_page_image\":{\"path\":\"contents\\/dexTFzz74cyndKFbhtAjlhGWz4nPax.avif\",\"driver\":\"local\"}}', '2024-11-13 02:21:24', '2024-11-13 02:21:24'),
(42, 'social', 'multiple', '{\"my_link\":\"https:\\/\\/www.facebook.com\\/\",\"icon\":\"fab fa-facebook-f\"}', '2024-11-09 16:13:39', '2024-11-09 16:13:39'),
(43, 'social', 'multiple', '{\"my_link\":\"https:\\/\\/twitter.com\\/\",\"icon\":\"fab fa-twitter\"}', '2024-11-08 22:30:25', '2024-11-08 22:30:25'),
(44, 'social', 'multiple', '{\"my_link\":\"https:\\/\\/linkedin.com\\/\",\"icon\":\"fab fa-linkedin\"}', '2024-11-16 03:30:20', '2024-11-16 03:30:20'),
(45, 'social', 'multiple', '{\"my_link\":\"https:\\/\\/www.instagram.com\\/\",\"icon\":\"fab fa-instagram\"}', '2024-11-11 14:00:07', '2024-11-11 14:00:07'),
(89, 'hero', 'single', '{\"my_link\":\"https:\\/\\/bugfinder.net\\/\",\"video_link\":\"https:\\/\\/www.youtube.com\\/@bugfinder3340\"}', '2024-11-10 23:43:48', '2024-11-10 23:43:48');

-- --------------------------------------------------------

--
-- Table structure for table `content_details`
--

CREATE TABLE `content_details` (
  `id` int(11) UNSIGNED NOT NULL,
  `content_id` int(11) DEFAULT NULL,
  `language_id` int(11) DEFAULT NULL,
  `description` longtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `content_details`
--

INSERT INTO `content_details` (`id`, `content_id`, `language_id`, `description`, `created_at`, `updated_at`) VALUES
(1, 1, 1, '{\"title\":\"Safety, Simplicity, and Market Excellence\",\"description\":\"<p>At CoinEctra, we\'re on a mission to make cryptocurrency trading and\\r\\n                            investment accessible, secure, and user-friendly for everyone. Founded by a team of\\r\\n                            passionate crypto enthusiasts, our platform was created with the vision of empowering\\r\\n                            individuals to explore the exciting world of digital currencies.<\\/p>\\r\\n                        <div class=\\\"cmn-item mt-20\\\">\\r\\n                            <h4>Who We Are <\\/h4>\\r\\n                            <p>We are a team of blockchain and cryptocurrency experts with years\\r\\n                                of experience in the industry. Our diverse backgrounds in finance, technology, and\\r\\n                                security enable us to provide you with a platform that prioritizes safety, transparency,\\r\\n                                and innovation.<\\/p><\\/div>\",\"button_name\":\"Explore More\"}', '2024-11-10 06:01:54', '2024-11-10 06:01:54'),
(2, 2, 1, '{\"title\":\"Benefits We Offer\",\"sub_title\":\"Connect your money to your friends &amp; family from anywhere, anytime regardless any delay. Lorem ipsum Nullana integer sagittis, eleifend. met, aliquere.\"}', '2024-11-10 19:44:20', '2024-11-10 19:44:20'),
(3, 3, 1, '{\"title\":\"Spot &amp; Margin\",\"sub_title\":\"Trade 500+ pairs with up to 5x leverage\"}', '2024-11-12 13:56:20', '2024-11-12 13:56:20'),
(4, 4, 1, '{\"title\":\"Derivatives\",\"sub_title\":\"100+ perpetuals and quarterly futures with up to 20x leverage\"}', '2024-11-07 10:32:51', '2024-11-07 10:32:51'),
(5, 5, 1, '{\"title\":\"Lockup &amp; Earn\",\"sub_title\":\"Earn daily rewards on your balance, no lock-up period\"}', '2024-11-14 20:49:25', '2024-11-14 20:49:25'),
(6, 6, 1, '{\"title\":\"Trading Arena\",\"sub_title\":\"Prize pools worth up to USD 1,000,000\"}', '2024-11-10 02:34:25', '2024-11-10 02:34:25'),
(7, 7, 1, '{\"title\":\"Buy Cryptocurrency in Just a Few Simple Steps\",\"sub_title\":\"Buying crypto on CoinEctra is secure and straightforward. Here\'s how you can do it:\"}', '2024-11-13 22:33:42', '2024-11-13 22:33:42'),
(8, 8, 1, '{\"title\":\"Create a CoinEctra Account\",\"sub_title\":\"Sign up on CoinEctra with your email address\\/phone number and country of residence, then create a strong password to secure your account.\"}', '2024-11-07 01:38:14', '2024-11-07 01:38:14'),
(9, 9, 1, '{\"title\":\"Verify Your Account\",\"sub_title\":\"Sign up on CoinEctra with your email address\\/phone number and country of residence, then create a strong password to secure your account.\"}', '2024-11-02 20:36:08', '2024-11-02 20:36:08'),
(10, 10, 1, '{\"title\":\"Add a Payment Method\",\"sub_title\":\"Add your credit card, debit card, or other payment methods to buy cryptocurrency. KuCoin supports over 70 payment methods.\"}', '2024-11-15 17:15:59', '2024-11-15 17:15:59'),
(11, 11, 1, '{\"title\":\"Buy Cryptocurrency\",\"sub_title\":\"You can now easily and securely purchase Bitcoin and other cryptocurrencies on KuCoin using USD, EUR, AUD, INR, RUB, and over 48 other local currencies.\"}', '2024-11-01 10:37:37', '2024-11-01 10:37:37'),
(12, 12, 1, '{\"title\":\"Why invest in CoinEctra\",\"sub_title\":\"Connect your money to your friends &amp; family from anywhere, anytime regardless any delay. Lorem ipsum Nullana integer sagittis, eleifend. met, aliquere.\"}', '2024-11-09 06:34:48', '2024-11-09 06:34:48'),
(13, 13, 1, '{\"title\":\"Security First\",\"sub_title\":\"We prioritize the security of your cryptocurrency holdings above all else.\"}', '2024-11-10 11:36:26', '2024-11-10 11:36:26'),
(14, 14, 1, '{\"title\":\"Global Reach\",\"sub_title\":\"CoinEctra serves a global community of cryptocurrency enthusiasts.\"}', '2024-11-07 04:49:02', '2024-11-07 04:49:02'),
(15, 15, 1, '{\"title\":\"User-Friendly Interface\",\"sub_title\":\"Whether you\'re a beginner or a seasoned trader, our intuitive platform makes buying, selling, and exchanging cryptocurrencies a breeze.\"}', '2024-11-10 22:56:23', '2024-11-10 22:56:23'),
(16, 16, 1, '{\"title\":\"Compliance and Trust\",\"sub_title\":\"CoinEctra adheres to strict regulatory standards, giving you peace of mind.\"}', '2024-11-13 20:52:37', '2024-11-13 20:52:37'),
(17, 17, 1, '{\"title\":\"Still, have questions?\",\"sub_title\":\"Lorem ipsum dolor sit amet, consectetur adipisicing elit. Perspiciatis, facere incidunt dolorum illum nesciunt eaque.\"}', '2024-11-16 03:27:07', '2024-11-16 03:27:07'),
(18, 18, 1, '{\"title\":\"How does the exchange service work?\",\"sub_title\":\"An exchange service facilitates swapping one item or currency for another. Users submit what they want to exchange and what they desire in return. The service matches these requests, enabling the trade to occur. Whether it\'s cryptocurrencies, goods, or services, exchanges provide a platform for seamless transactions between parties.\"}', '2024-11-12 05:46:47', '2024-11-12 05:46:47'),
(19, 19, 1, '{\"title\":\"How long does it take for a exchange to be processed?\",\"sub_title\":\"The processing time for an exchange varies depending on factors like the platform used, transaction volume, and network speed. It can range from a few minutes to several hours, sometimes longer for complex transactions.\"}', '2024-11-12 19:53:48', '2024-11-12 19:53:48'),
(20, 20, 1, '{\"title\":\"Can I track the status of my exchange?\",\"sub_title\":\"Yes, you can track the status of your crypto exchange through our tracking. We also provide email notifications for important updates during the exchange process.\"}', '2024-11-05 17:21:35', '2024-11-05 17:21:35'),
(21, 21, 1, '{\"title\":\"Is my personal and financial information safe on your website?\",\"sub_title\":\"Yes, we take the security of your personal and financial information seriously. Our website employs robust encryption protocols and follows industry best practices to safeguard your data from unauthorized access or misuse.\"}', '2024-11-07 09:47:37', '2024-11-07 09:47:37'),
(22, 22, 1, '{\"title\":\"What payment methods do you support for sell crypto?\",\"sub_title\":\"We offer nearly 32 fiat gateway methods and ensure fiat transfers are completed within 10 minutes, guaranteeing swift and convenient transactions for our users.\"}', '2024-11-01 15:21:01', '2024-11-01 15:21:01'),
(23, 23, 1, '{\"title\":\"Are there any fees associated with sending or receiving crypto?\",\"sub_title\":\"Yes, there might be fees associated with crypto exchange. The applicable fees will be displayed before you confirm the trade.\"}', '2024-11-16 17:41:34', '2024-11-16 17:41:34'),
(24, 24, 1, '{\"title\":\"what our Clients Say\",\"sub_title\":\"Help agencies to define their new business objectives and then create professional software. Lorem ipsum, dolor sit amet\"}', '2024-11-02 07:57:14', '2024-11-02 07:57:14'),
(28, 28, 1, '{\"name\":\"Mitsubishi\",\"address\":\"Tokyo, Japan\",\"star\":\"4\",\"description\":\"We highly appreciate this exceptional crypto exchange platform for its efficiency and user-friendly interface, making it an invaluable tool for exchanging cryptocurrencies seamlessly.\"}', '2024-11-02 16:14:14', '2024-11-02 16:14:14'),
(29, 29, 1, '{\"name\":\"Tom Haris\",\"address\":\"New York, USA\",\"star\":\"5\",\"description\":\"The administration here is remarkably swift with exchanges. I received my completed exchange in just 5 minutes. Highly impressive!. Go and get your future assets\"}', '2024-11-02 17:00:15', '2024-11-02 17:00:15'),
(30, 30, 1, '{\"name\":\"Jim Morison\",\"address\":\"London, UK\",\"star\":\"5\",\"description\":\"Their support team is incredibly helpful, responding to inquiries within minutes. It\'s remarkable how prompt and efficient their assistance is.\"}', '2024-11-06 09:14:29', '2024-11-06 09:14:29'),
(31, 31, 1, '{\"name\":\"Alex Cruis\",\"address\":\"Dublin, Ireland\",\"star\":\"4\",\"description\":\"We highly appreciate this exceptional crypto exchange platform for its efficiency and user-friendly interface, making it an invaluable tool for exchanging cryptocurrencies seamlessly.\"}', '2024-11-03 02:52:02', '2024-11-03 02:52:02'),
(32, 32, 1, '{\"name\":\"Alex Cruis\",\"address\":\"Sydney, Australia\",\"star\":\"5\",\"description\":\"The administration here is remarkably swift with exchanges. I received my completed exchange in just 5 minutes. Highly impressive!. Go and get your future assets\"}', '2024-11-12 07:42:09', '2024-11-12 07:42:09'),
(33, 33, 1, '{\"title\":\"Latest Blogs &amp; Articles\",\"sub_title\":\"In today\'s fast-paced world, managing Travellerments can become a tedious and time-consuming task. Fortunately, with the advent of online payment services.\"}', '2024-11-02 04:49:47', '2024-11-02 04:49:47'),
(35, 35, 1, '{\"title\":\"Tips for Success in the Cryptocurrency Market\",\"description\":\"<p>Share data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\nLorem, ipsum dolor sit amet consectetur adipisicing elit. Quia rem aut maxime neque, nesciunt corporis quos magnam reprehenderit harum atque.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices.<\\/p><p> Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n<\\/p>\"}', '2024-11-06 04:09:01', '2024-11-06 04:09:01'),
(36, 36, 1, '{\"title\":\"Understanding the Basics: A Beginner\'s Guide to Cryptocurrency\",\"description\":\"<p>Share data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\nLorem, ipsum dolor sit amet consectetur adipisicing elit.<\\/p><p> Quia rem aut maxime neque, nesciunt corporis quos magnam reprehenderit harum atque.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n<\\/p>\"}', '2024-11-09 21:34:29', '2024-11-09 21:34:29'),
(37, 37, 1, '{\"title\":\"Keep Your Cryptocurrency Safe\",\"description\":\"<p>Share data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\nLorem, ipsum dolor sit amet consectetur adipisicing elit. Quia rem aut maxime neque, nesciunt corporis quos magnam reprehenderit harum atque.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit.<\\/p><p> Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n<\\/p>\"}', '2024-11-08 01:35:54', '2024-11-08 01:35:54'),
(38, 38, 1, '{\"title\":\"The Rise of Altcoins: Exploring Alternative Cryptocurrencies\",\"description\":\"<p>Share data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>\\r\\nLorem, ipsum dolor sit amet consectetur adipisicing elit. Quia rem aut maxime neque, nesciunt corporis quos magnam reprehenderit harum atque.\\r\\n\\r\\nShare data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.<\\/p><p>Share data on the carbon footprint of travel, eco-friendly destinations, and sustainable travel practices. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione, eligendi sapiente eveniet sequi consectetur quidem corporis quaerat repellendus aliquam fuga minus modi dolorum dolore, natus nihil molestias eius ad est.\\r\\n                      <\\/p>\"}', '2024-11-09 03:44:53', '2024-11-09 03:44:53'),
(39, 39, 1, '{\"title\":\"Subscribe to our mailing list and stay up to date\",\"sub_title\":\"Lorem ipsum dolor sit amet consectetur, adipisicing elit. Illo, hic!\"}', '2024-11-13 11:14:06', '2024-11-13 11:14:06'),
(40, 40, 1, '{\"phone\":\"+45345847431324\",\"email\":\"demo@example.com\",\"address\":\"22 Baker Street, London\",\"contact_message\":\"Give us a call or drop by anytime, we endeavour to answer all enquiries within 24 hours on business days. We will be happy to answer your questions.\",\"drop_line_message\":\"Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quia blanditiis consequuntur rem, sit itaque impedit.\",\"footer_message\":\"Lorem ipsum dolor sit, amet consectetur adipisicing elit. Consequuntur fuga odit excepturi, natus voluptate commodi qui sunt quisquam cupiditate molestiae?\"}', '2024-11-17 20:07:07', '2024-11-17 20:07:07'),
(41, 41, 1, '{\"login_heading\":\"Login Here!\",\"login_sub_heading\":\"Hey Enter your details to get sign in to your account\",\"register_heading\":\"Register Here!\",\"register_sub_heading\":\"Hey Enter your details to get sign up to your account\"}', '2024-11-04 14:26:09', '2024-11-04 14:26:09'),
(42, 42, 1, '{\"name\":\"Facebook\"}', '2024-11-16 06:40:12', '2024-11-16 06:40:12'),
(43, 43, 1, '{\"name\":\"Twitter\"}', '2024-11-08 02:28:12', '2024-11-08 02:28:12'),
(44, 44, 1, '{\"name\":\"Linkedin\"}', '2024-11-05 01:34:27', '2024-11-05 01:34:27'),
(45, 45, 1, '{\"name\":\"Instagram\"}', '2024-11-13 00:43:51', '2024-11-13 00:43:51'),
(125, 89, 1, '{\"heading\":\"Exchange Any Crypto Securely And Easily\",\"sub_heading\":\"Empower Your Financial Future with Crypto: Buy, Sell, and Exchange Your Way to Success!\",\"button_name\":\"Get Started\",\"video_button_name\":\"Watch Now\"}', '2024-11-05 16:02:55', '2024-11-05 16:02:55');

-- --------------------------------------------------------

--
-- Table structure for table `crypto_currencies`
--

CREATE TABLE `crypto_currencies` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `code` varchar(255) DEFAULT NULL,
  `symbol` varchar(255) DEFAULT NULL,
  `rate` double NOT NULL DEFAULT 1 COMMENT 'Rate equivalent base currecny',
  `usd_rate` double NOT NULL DEFAULT 1 COMMENT 'rate in USD',
  `service_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'In crypto',
  `service_fee_type` enum('percent','flat') NOT NULL DEFAULT 'percent',
  `network_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'In crypto',
  `network_fee_type` enum('percent','flat') NOT NULL DEFAULT 'percent',
  `min_send` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'In crypto',
  `max_send` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'In crypto',
  `image` text DEFAULT NULL,
  `driver` varchar(255) NOT NULL DEFAULT 'local',
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0=>inactive,1=>active',
  `sort_by` int(11) NOT NULL DEFAULT 1,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `crypto_methods`
--

CREATE TABLE `crypto_methods` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `code` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `parameters` text DEFAULT NULL,
  `extra_parameters` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=>inactive,1=>active',
  `is_automatic` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0=>manual,1=>automatic',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `crypto_methods`
--

INSERT INTO `crypto_methods` (`id`, `code`, `name`, `parameters`, `extra_parameters`, `description`, `status`, `is_automatic`, `created_at`, `updated_at`) VALUES
(1, 'coin_payment', 'CoinPayment', '{\"public_key\":\"\",\"private_key\":\"\",\"mercent_id\":\"\"}', NULL, 'Using CoinPayments, merchants can accept crypto payments via APIs and a mobile POS system, and choose to either hold the funds in cryptocurrency or have them automatically converted into fiat currency and sent into a company bank account<br><br>Get your free API keys <a href=\"https://www.coinpayments.net/register\" target=\"_blank\">Create an account <i class=\"fas fa-external-link-alt\"></i></a>, then create a account.\r\nGo to the panel page for public key, Private key and Merchant ID.', 0, 1, '2024-11-03 18:43:43', '2024-11-03 18:43:43'),
(2, 'crypto_apis', 'CryptoAPIs', '{\"api_key\":\"\",\"wallet_id\":\"\"}', NULL, 'Using Crypto APIs, merchants can accept crypto payments via APIs and a mobile POS system, and choose to either hold the funds in cryptocurrency or have them automatically converted into fiat currency and sent into a company bank account<br><br>Get your free API keys <a href=\"https://my.cryptoapis.io/login\" target=\"_blank\">Create an account <i class=\"fas fa-external-link-alt\"></i></a>, then create a account.\r\nGo to the panel page for Api key and Wallet ID.', 0, 1, '2024-11-09 19:35:07', '2024-11-09 19:35:07'),
(3, 'manual', 'Manual', '{\"BTC\":\"\"}', NULL, NULL, 1, 0, '2024-11-02 18:19:00', '2024-11-02 18:19:00'),
(4, 'crypto_cloud', 'CryptoCloud', '{\"api_key\":\"\",\"shop_id\":\"\",\"secret_key\":\"\",\"payout_api_key\":\"\",\"currency_map\":\"USDT=USDT_TRC20\\nUSDC=USDC_ERC20\"}', NULL, 'CryptoCloud works as an automatic crypto processor with static wallet deposits, POSTBACK notifications and payout API.<br><br>Create a project in <a href=\"https://cryptocloud.plus\" target=\"_blank\">CryptoCloud <i class=\"fas fa-external-link-alt\"></i></a>, then copy API KEY, SHOP ID and SECRET KEY from the project settings. Generate PAYOUT API KEY in the Security section. In project notifications set the URL to <code>/api/deposit/webhook/crypto_cloud</code> on your public domain. Use <code>currency_map</code> to map project codes to provider codes, for example <code>USDT=USDT_TRC20</code>.', 0, 1, '2026-03-12 21:00:00', '2026-03-12 21:00:00');

-- --------------------------------------------------------

--
-- Table structure for table `deposits`
--

CREATE TABLE `deposits` (
  `id` int(11) UNSIGNED NOT NULL,
  `depositable_id` int(11) DEFAULT NULL,
  `depositable_type` varchar(191) DEFAULT NULL,
  `user_id` int(11) UNSIGNED DEFAULT NULL,
  `payment_method_id` int(11) UNSIGNED DEFAULT NULL,
  `payment_method_currency` varchar(191) DEFAULT NULL,
  `amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `percentage` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'Percent of charge',
  `charge_percentage` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'After adding percent of charge',
  `charge_fixed` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `charge` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'Total charge',
  `payable_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'Amount payed',
  `payable_amount_base_currency` double(18,8) NOT NULL DEFAULT 0.00000000,
  `btc_amount` decimal(18,8) DEFAULT NULL,
  `btc_wallet` varchar(191) DEFAULT NULL,
  `information` text DEFAULT NULL,
  `trx_id` char(36) DEFAULT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0=pending, 1=success, 2=request, 3=rejected',
  `note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `exchange_requests`
--

CREATE TABLE `exchange_requests` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `send_currency_id` bigint(20) UNSIGNED NOT NULL,
  `get_currency_id` bigint(20) UNSIGNED NOT NULL,
  `crypto_method_id` int(11) DEFAULT NULL,
  `send_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `get_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `exchange_rate` decimal(18,8) NOT NULL DEFAULT 1.00000000,
  `service_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `network_fee` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `final_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000 COMMENT 'After deduct all fees',
  `rate_type` enum('floating','fixed') NOT NULL DEFAULT 'floating',
  `destination_wallet` varchar(255) DEFAULT NULL COMMENT 'which address crypto send',
  `admin_wallet` varchar(255) DEFAULT NULL COMMENT 'admin crypto wallet address',
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0=>initiate,1=>give_address,2=>deposit_amount,3=>exchange_completed,4=>time_expired,5=>cancel',
  `utr` varchar(50) DEFAULT NULL,
  `expire_time` timestamp NULL DEFAULT NULL COMMENT 'the expire time of crypto payment',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `failed_jobs`
--

CREATE TABLE `failed_jobs` (
  `id` int(11) UNSIGNED NOT NULL,
  `uuid` varchar(191) NOT NULL,
  `connection` text NOT NULL,
  `queue` text NOT NULL,
  `payload` longtext NOT NULL,
  `exception` longtext NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `fiat_currencies`
--

CREATE TABLE `fiat_currencies` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `code` varchar(255) DEFAULT NULL,
  `symbol` varchar(255) DEFAULT NULL,
  `rate` decimal(18,8) NOT NULL DEFAULT 1.00000000 COMMENT 'Rate equivalent base currency',
  `usd_rate` decimal(18,8) NOT NULL DEFAULT 1.00000000 COMMENT '	rate equivalent USD',
  `rate_markup_percent` decimal(8,2) NOT NULL DEFAULT 0.00,
  `processing_fee` double NOT NULL DEFAULT 0 COMMENT 'In fiat',
  `processing_fee_type` enum('percent','flat') NOT NULL DEFAULT 'percent',
  `min_send` double NOT NULL DEFAULT 0 COMMENT 'In fiat',
  `max_send` double NOT NULL DEFAULT 0 COMMENT 'In fiat',
  `image` text DEFAULT NULL,
  `driver` varchar(255) NOT NULL DEFAULT 'local',
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0=>inactive,1=>active',
  `show_in_buy` tinyint(1) NOT NULL DEFAULT 1,
  `buy_gateway_id` bigint(20) UNSIGNED DEFAULT NULL,
  `show_in_sell` tinyint(1) NOT NULL DEFAULT 1,
  `fiat_send_gateway_id` bigint(20) UNSIGNED DEFAULT NULL,
  `sort_by` int(11) NOT NULL DEFAULT 1,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `fiat_send_gateways`
--

CREATE TABLE `fiat_send_gateways` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `image` varchar(255) DEFAULT NULL,
  `driver` varchar(255) DEFAULT NULL,
  `parameters` text DEFAULT NULL,
  `supported_currency` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0=>inactive,1=>active',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `fiat_send_gateways`
--

INSERT INTO `fiat_send_gateways` (`id`, `name`, `image`, `driver`, `parameters`, `supported_currency`, `description`, `status`, `created_at`, `updated_at`) VALUES
(1, 'Stripe', 'fiat_gateway/U2AxTjp2S1toso38oRmRd3ylrjN67Y.webp', 'local', '{\"AccountNumber\":{\"field_name\":\"AccountNumber\",\"field_label\":\"Account Number\",\"type\":\"text\",\"validation\":\"required\"},\"BeneficiaryName\":{\"field_name\":\"BeneficiaryName\",\"field_label\":\"Beneficiary Name\",\"type\":\"text\",\"validation\":\"required\"},\"RoutingName\":{\"field_name\":\"RoutingName\",\"field_label\":\"Routing Name\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"EUR\",\"BDT\",\"GBP\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"CNY\",\"INR\",\"JPY\",\"QAR\",\"OMR\",\"NGN\"]', 'Please give account details for make transaction', 1, '2024-03-14 05:26:27', '2024-03-31 07:49:58'),
(2, 'Paypal', 'fiat_gateway/e4X9UbCGizfFCcUQTEyMXSQsAnyvYp.webp', 'local', '{\"AccountNumber\":{\"field_name\":\"AccountNumber\",\"field_label\":\"Account Number\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"EUR\",\"GBP\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"JPY\",\"SAR\",\"QAR\",\"BDT\",\"NGN\"]', 'Please give account details for make transaction easily', 1, '2024-03-16 04:44:26', '2024-03-31 07:49:33'),
(3, 'Flutterwave', 'fiat_gateway/W7UE878VkjD43gLy95eRXbhxKCS3EX.webp', 'local', '{\"AccountDetails\":{\"field_name\":\"AccountDetails\",\"field_label\":\"Account Details\",\"type\":\"text\",\"validation\":\"required\"},\"RoutingNumber\":{\"field_name\":\"RoutingNumber\",\"field_label\":\"Routing Number\",\"type\":\"number\",\"validation\":\"required\"}}', '[\"USD\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"INR\",\"JPY\",\"SAR\",\"EUR\",\"BDT\",\"GBP\",\"NGN\"]', 'Please give account details for make transaction easily', 1, '2024-03-16 04:45:53', '2024-03-31 07:51:54'),
(4, 'Paystack', 'fiat_gateway/gPY1AfsZd9Jx9TPKCySp7PUhjHjFf6.webp', 'local', '{\"AccountDetails\":{\"field_name\":\"AccountDetails\",\"field_label\":\"Account Details\",\"type\":\"text\",\"validation\":\"required\"},\"RoutingNumber\":{\"field_name\":\"RoutingNumber\",\"field_label\":\"Routing Number\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"CNY\",\"INR\",\"JPY\",\"SAR\",\"OMR\",\"BDT\",\"GBP\"]', 'Please give account details for make transaction easily', 1, '2024-03-31 07:52:18', '2024-03-31 07:52:18'),
(5, 'Mollie', 'fiat_gateway/Lbus5cwlg1HSump574CGIBfR3P1a0J.webp', 'local', '{\"AccountDetails\":{\"field_name\":\"AccountDetails\",\"field_label\":\"Account Details\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"CNY\",\"INR\",\"JPY\",\"SAR\",\"QAR\",\"EUR\",\"BDT\",\"GBP\",\"NGN\"]', 'Please give account details for make transaction easily', 1, '2024-03-31 07:53:14', '2024-03-31 07:53:14'),
(6, 'Payeer', 'fiat_gateway/ZGaLTloHkZkJKQfDNIDdV9qT5YUYnQ.webp', 'local', '{\"AccountNumber\":{\"field_name\":\"AccountNumber\",\"field_label\":\"Account Number\",\"type\":\"text\",\"validation\":\"required\"},\"BeneficiaryName\":{\"field_name\":\"BeneficiaryName\",\"field_label\":\"Beneficiary Name\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"CAD\",\"AUD\",\"BRL\",\"CNY\",\"INR\",\"JPY\",\"QAR\",\"OMR\",\"EUR\",\"BDT\",\"GBP\",\"NGN\"]', 'Please give account details for make transaction easily', 1, '2024-03-31 07:54:38', '2024-03-31 07:54:38'),
(7, 'Paytam', 'fiat_gateway/MmTzR9jhE0J9FrVph4Y8MDFuVTWS28.webp', 'local', '{\"AccountNumber\":{\"field_name\":\"AccountNumber\",\"field_label\":\"Account Number\",\"type\":\"text\",\"validation\":\"required\"},\"BranchName\":{\"field_name\":\"BranchName\",\"field_label\":\"Branch Name\",\"type\":\"text\",\"validation\":\"required\"}}', '[\"USD\",\"CAD\",\"AUD\",\"BRL\",\"CHF\",\"CNY\",\"SAR\",\"OMR\",\"EUR\",\"BDT\",\"GBP\",\"NGN\"]', 'Please give account details for make transaction easily', 1, '2024-03-31 07:59:58', '2024-03-31 07:59:58');

-- --------------------------------------------------------

--
-- Table structure for table `file_storages`
--

CREATE TABLE `file_storages` (
  `id` int(11) UNSIGNED NOT NULL,
  `code` varchar(20) DEFAULT NULL,
  `name` varchar(191) DEFAULT NULL,
  `logo` text DEFAULT NULL,
  `driver` varchar(20) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 => active, 0 => inactive',
  `parameters` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `file_storages`
--

INSERT INTO `file_storages` (`id`, `code`, `name`, `logo`, `driver`, `status`, `parameters`, `created_at`, `updated_at`) VALUES
(1, 's3', 'Amazon S3', 'driver/GJrBdvIxtnEprk0kHylgzNh6LcGcfOUcA205IIK5.png', 'local', 0, '{\"access_key_id\":\"xys6\",\"secret_access_key\":\"xys\",\"default_region\":\"xys5\",\"bucket\":\"xys6\",\"url\":\"xysds\"}', NULL, '2023-10-15 03:24:29'),
(2, 'sftp', 'SFTP', 'driver/q8E08YsobyRZGOLHHeKGhwysWsi25F186EbaNNRx.png', 'local', 0, '{\"sftp_username\":\"xys6\",\"sftp_password\":\"xys\"}', NULL, '2023-06-10 23:28:03'),
(3, 'do', 'Digitalocean Spaces', 'driver/iA8q685PBCnOAkmctLXZWhyqSoh7cJMOewpW4S8r.png', 'local', 0, '{\"spaces_key\":\"hj\",\"spaces_secret\":\"vh\",\"spaces_endpoint\":\"jk\",\"spaces_region\":\"sfo2\",\"spaces_bucket\":\"assets-coral\"}', NULL, '2023-06-10 23:45:21'),
(4, 'ftp', 'FTP', 'driver/wIwEOAJ45KgVGw0PL80WNfcbosB4IuUlxStfeHCX.png', 'local', 0, '{\"ftp_host\":\"xys6\",\"ftp_username\":\"xys\",\"ftp_password\":\"xys6\"}', NULL, '2023-06-10 23:27:43'),
(5, 'local', 'Local Storage', '', NULL, 1, NULL, NULL, '2023-06-19 09:28:18');

-- --------------------------------------------------------

--
-- Table structure for table `fire_base_tokens`
--

CREATE TABLE `fire_base_tokens` (
  `id` int(11) UNSIGNED NOT NULL,
  `tokenable_id` int(11) DEFAULT NULL,
  `tokenable_type` varchar(191) DEFAULT NULL,
  `token` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `funds`
--

CREATE TABLE `funds` (
  `id` int(11) UNSIGNED NOT NULL,
  `user_id` int(11) UNSIGNED DEFAULT NULL,
  `gateway_id` int(11) UNSIGNED DEFAULT NULL,
  `fundable_id` int(11) UNSIGNED DEFAULT NULL,
  `fundable_type` varchar(91) NOT NULL,
  `gateway_currency` varchar(191) DEFAULT NULL,
  `amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `charge` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `percentage_charge` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `fixed_charge` decimal(18,8) DEFAULT 0.00000000,
  `final_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `payable_amount_base_currency` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `btc_amount` decimal(18,8) DEFAULT NULL,
  `btc_wallet` varchar(191) DEFAULT NULL,
  `transaction` varchar(25) DEFAULT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '1=> Complete, 2=> Pending, 3 => Cancel, 4=> failed',
  `detail` text DEFAULT NULL,
  `feedback` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `validation_token` varchar(191) DEFAULT NULL,
  `referenceno` varchar(191) DEFAULT NULL,
  `reason` varchar(191) DEFAULT NULL,
  `information` text DEFAULT NULL,
  `api_response` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `gateways`
--

CREATE TABLE `gateways` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `code` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sort_by` int(11) DEFAULT 1,
  `image` varchar(191) DEFAULT NULL,
  `driver` varchar(20) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0: inactive, 1: active',
  `parameters` text DEFAULT NULL,
  `currencies` text DEFAULT NULL,
  `extra_parameters` text DEFAULT NULL,
  `supported_currency` varchar(255) DEFAULT NULL,
  `receivable_currencies` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `currency_type` tinyint(1) NOT NULL DEFAULT 1,
  `is_sandbox` tinyint(1) NOT NULL DEFAULT 0,
  `environment` enum('test','live') NOT NULL DEFAULT 'live',
  `is_manual` tinyint(1) DEFAULT 1,
  `note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `gateways`
--

INSERT INTO `gateways` (`id`, `code`, `name`, `sort_by`, `image`, `driver`, `status`, `parameters`, `currencies`, `extra_parameters`, `supported_currency`, `receivable_currencies`, `description`, `currency_type`, `is_sandbox`, `environment`, `is_manual`, `note`, `created_at`, `updated_at`) VALUES
(1, 'paypal', 'Paypal', 10, 'gateway/cCmKX4VMzHorJkQ9omsZdOLIZLXA56.avif', 'local', 0, '{\"cleint_id\":\"\",\"secret\":\"\"}', '{\"0\":{\"AUD\":\"AUD\",\"BRL\":\"BRL\",\"CAD\":\"CAD\",\"CZK\":\"CZK\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"HKD\":\"HKD\",\"HUF\":\"HUF\",\"INR\":\"INR\",\"ILS\":\"ILS\",\"JPY\":\"JPY\",\"MYR\":\"MYR\",\"MXN\":\"MXN\",\"TWD\":\"TWD\",\"NZD\":\"NZD\",\"NOK\":\"NOK\",\"PHP\":\"PHP\",\"PLN\":\"PLN\",\"GBP\":\"GBP\",\"RUB\":\"RUB\",\"SGD\":\"SGD\",\"SEK\":\"SEK\",\"CHF\":\"CHF\",\"THB\":\"THB\",\"USD\":\"USD\"}}', NULL, '[\"USD\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(2, 'stripe', 'Stripe ', 1, 'gateway/Fpn6DbOj8Kh0qEqmDcqzPLaYetzHdU.avif', 'local', 0, '{\"secret_key\":\"\",\"publishable_key\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"AUD\":\"AUD\",\"BRL\":\"BRL\",\"CAD\":\"CAD\",\"CHF\":\"CHF\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"HKD\":\"HKD\",\"INR\":\"INR\",\"JPY\":\"JPY\",\"MXN\":\"MXN\",\"MYR\":\"MYR\",\"NOK\":\"NOK\",\"NZD\":\"NZD\",\"PLN\":\"PLN\",\"SEK\":\"SEK\",\"SGD\":\"SGD\"}}', NULL, '[\"USD\",\"AUD\",\"EUR\",\"GBP\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0.5\"},{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.0072\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"},{\"name\":\"EUR\",\"currency_symbol\":\"GBP\",\"conversion_rate\":\"0.0068\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"1\",\"fixed_charge\":\"1\"},{\"name\":\"GBP\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0068\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"1\",\"fixed_charge\":\"1\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(3, 'skrill', 'Skrill', 3, 'gateway/sFW8RqOtyTiIo8369MLJFmMsfHtYHX.avif', 'local', 0, '{\"pay_to_email\":\"\",\"secret_key\":\"\"}', '{\"0\":{\"AED\":\"AED\",\"AUD\":\"AUD\",\"BGN\":\"BGN\",\"BHD\":\"BHD\",\"CAD\":\"CAD\",\"CHF\":\"CHF\",\"CZK\":\"CZK\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"HKD\":\"HKD\",\"HRK\":\"HRK\",\"HUF\":\"HUF\",\"ILS\":\"ILS\",\"INR\":\"INR\",\"ISK\":\"ISK\",\"JOD\":\"JOD\",\"JPY\":\"JPY\",\"KRW\":\"KRW\",\"KWD\":\"KWD\",\"MAD\":\"MAD\",\"MYR\":\"MYR\",\"NOK\":\"NOK\",\"NZD\":\"NZD\",\"OMR\":\"OMR\",\"PLN\":\"PLN\",\"QAR\":\"QAR\",\"RON\":\"RON\",\"RSD\":\"RSD\",\"SAR\":\"SAR\",\"SEK\":\"SEK\",\"SGD\":\"SGD\",\"THB\":\"THB\",\"TND\":\"TND\",\"TRY\":\"TRY\",\"TWD\":\"TWD\",\"USD\":\"USD\",\"ZAR\":\"ZAR\",\"COP\":\"COP\"}}', NULL, '[\"AUD\",\"USD\"]', '[{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.014\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"},{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(4, 'perfectmoney', 'Perfect Money', 8, 'gateway/B1uwuCo5fk4FVyBSm8yxErDtezvo9R.avif', 'local', 0, '{\"passphrase\":\"\",\"payee_account\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"EUR\":\"EUR\"}}', NULL, '[\"USD\",\"EUR\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"},{\"name\":\"EUR\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0083\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(5, 'paytm', 'PayTM', 23, 'gateway/9OxY8ZDv4JGt3MS7zPEquDtQ9b1vWU.avif', 'local', 0, '{\"MID\":\"\",\"merchant_key\":\"\",\"WEBSITE\":\"\",\"INDUSTRY_TYPE_ID\":\"\",\"CHANNEL_ID\":\"\",\"environment_url\":\"\",\"process_transaction_url\":\"\"}', '{\"0\":{\"AUD\":\"AUD\",\"ARS\":\"ARS\",\"BDT\":\"BDT\",\"BRL\":\"BRL\",\"BGN\":\"BGN\",\"CAD\":\"CAD\",\"CLP\":\"CLP\",\"CNY\":\"CNY\",\"COP\":\"COP\",\"HRK\":\"HRK\",\"CZK\":\"CZK\",\"DKK\":\"DKK\",\"EGP\":\"EGP\",\"EUR\":\"EUR\",\"GEL\":\"GEL\",\"GHS\":\"GHS\",\"HKD\":\"HKD\",\"HUF\":\"HUF\",\"INR\":\"INR\",\"IDR\":\"IDR\",\"ILS\":\"ILS\",\"JPY\":\"JPY\",\"KES\":\"KES\",\"MYR\":\"MYR\",\"MXN\":\"MXN\",\"MAD\":\"MAD\",\"NPR\":\"NPR\",\"NZD\":\"NZD\",\"NGN\":\"NGN\",\"NOK\":\"NOK\",\"PKR\":\"PKR\",\"PEN\":\"PEN\",\"PHP\":\"PHP\",\"PLN\":\"PLN\",\"RON\":\"RON\",\"RUB\":\"RUB\",\"SGD\":\"SGD\",\"ZAR\":\"ZAR\",\"KRW\":\"KRW\",\"LKR\":\"LKR\",\"SEK\":\"SEK\",\"CHF\":\"CHF\",\"THB\":\"THB\",\"TRY\":\"TRY\",\"UGX\":\"UGX\",\"UAH\":\"UAH\",\"AED\":\"AED\",\"GBP\":\"GBP\",\"USD\":\"USD\",\"VND\":\"VND\",\"XOF\":\"XOF\"}}', NULL, '[\"AUD\",\"CAD\"]', '[{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.014\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"CAD\",\"currency_symbol\":\"CAD\",\"conversion_rate\":\"0.012\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(6, 'payeer', 'Payeer', 17, 'gateway/7HTCjJpFcRmHqM1kJSpaRuTA0MzNqG.avif', 'local', 0, '{\"merchant_id\":\"\",\"secret_key\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"EUR\":\"EUR\",\"RUB\":\"RUB\"}}', '{\"status\":\"ipn\"}', '[\"USD\",\"RUB\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"1\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"RUB\",\"currency_symbol\":\"RUD\",\"conversion_rate\":\"0.81\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(7, 'paystack', 'PayStack', 5, 'gateway/Km8ogMTUmpEdjbHRvLma7enfvafO3N.avif', 'local', 0, '{\"public_key\":\"\",\"secret_key\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"NGN\":\"NGN\"}}', '{\"callback\":\"ipn\",\"webhook\":\"ipn\"}\r\n', '[\"USD\",\"NGN\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"NGN\",\"currency_symbol\":\"NGN\",\"conversion_rate\":\"7.40\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(8, 'voguepay', 'VoguePay', 34, 'gateway/x6HOsziQhmuJ7iu46zMKdBEewDSesm.avif', 'local', 0, '{\"merchant_id\":\"\"}', '{\"0\":{\"NGN\":\"NGN\",\"USD\":\"USD\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"ZAR\":\"ZAR\",\"JPY\":\"JPY\",\"INR\":\"INR\",\"AUD\":\"AUD\",\"CAD\":\"CAD\",\"NZD\":\"NZD\",\"NOK\":\"NOK\",\"PLN\":\"PLN\"}}\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n', NULL, '[\"NGN\",\"EUR\"]', '[{\"name\":\"NGN\",\"currency_symbol\":\"NGN\",\"conversion_rate\":\"7.40\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"EUR\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0083\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(9, 'flutterwave', 'Flutterwave', 4, 'gateway/SUpub5TEkx7MOcetX340zn7LGSH0Sa.avif', 'local', 0, '{\"public_key\":\"\",\"secret_key\":\"\",\"encryption_key\":\"\"}', '{\"0\":{\"KES\":\"KES\",\"GHS\":\"GHS\",\"NGN\":\"NGN\",\"USD\":\"USD\",\"GBP\":\"GBP\",\"EUR\":\"EUR\",\"UGX\":\"UGX\",\"TZS\":\"TZS\"}}', NULL, '[\"GHS\",\"NGN\",\"USD\"]', '[{\"name\":\"GHS\",\"currency_symbol\":\"GHS\",\"conversion_rate\":\"0.11\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"NGN\",\"currency_symbol\":\"NGN\",\"conversion_rate\":\"7.40\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'test', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(10, 'razorpay', 'RazorPay', 6, 'gateway/HvTfH2WAQtw0pcN4ZzssUT5l86FMCZ.avif', 'local', 0, '{\"key_id\":\"\",\"key_secret\":\"\"}', '{\"0\":{\"INR\":\"INR\"}}', NULL, '[\"INR\"]', '[{\"name\":\"INR\",\"currency_symbol\":\"INR\",\"conversion_rate\":\"0.76\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(11, 'instamojo', 'instamojo', 13, 'gateway/rwXQ1P62ePQcvJBIUZRkHMumLbWF73.avif', 'local', 0, '{\"api_key\":\"\",\"auth_token\":\"\",\"salt\":\"\"}', '{\"0\":{\"INR\":\"INR\"}}', NULL, '[\"INR\"]', '[{\"name\":\"INR\",\"currency_symbol\":\"INR\",\"conversion_rate\":\"0.76\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(12, 'mollie', 'Mollie', 27, 'gateway/S83QZxmVtxCkvl8OGWFGgChxmUcQhc.avif', 'local', 0, '{\"api_key\":\"\"}', '{\"0\":{\"AED\":\"AED\",\"AUD\":\"AUD\",\"BGN\":\"BGN\",\"BRL\":\"BRL\",\"CAD\":\"CAD\",\"CHF\":\"CHF\",\"CZK\":\"CZK\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"HKD\":\"HKD\",\"HRK\":\"HRK\",\"HUF\":\"HUF\",\"ILS\":\"ILS\",\"ISK\":\"ISK\",\"JPY\":\"JPY\",\"MXN\":\"MXN\",\"MYR\":\"MYR\",\"NOK\":\"NOK\",\"NZD\":\"NZD\",\"PHP\":\"PHP\",\"PLN\":\"PLN\",\"RON\":\"RON\",\"RUB\":\"RUB\",\"SEK\":\"SEK\",\"SGD\":\"SGD\",\"THB\":\"THB\",\"TWD\":\"TWD\",\"USD\":\"USD\",\"ZAR\":\"ZAR\"}}', NULL, '[\"AUD\",\"BRL\"]', '[{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.014\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"BRL\",\"currency_symbol\":\"BRL\",\"conversion_rate\":\"0.045\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(13, 'twocheckout', '2checkout', 11, 'gateway/bmAgQ5rUbx2rktlaztA89GEQCKYTxJ.avif', 'local', 0, '{\"merchant_code\":\"\",\"secret_key\":\"\"}', '{\"0\":{\"AFN\":\"AFN\",\"ALL\":\"ALL\",\"DZD\":\"DZD\",\"ARS\":\"ARS\",\"AUD\":\"AUD\",\"AZN\":\"AZN\",\"BSD\":\"BSD\",\"BDT\":\"BDT\",\"BBD\":\"BBD\",\"BZD\":\"BZD\",\"BMD\":\"BMD\",\"BOB\":\"BOB\",\"BWP\":\"BWP\",\"BRL\":\"BRL\",\"GBP\":\"GBP\",\"BND\":\"BND\",\"BGN\":\"BGN\",\"CAD\":\"CAD\",\"CLP\":\"CLP\",\"CNY\":\"CNY\",\"COP\":\"COP\",\"CRC\":\"CRC\",\"HRK\":\"HRK\",\"CZK\":\"CZK\",\"DKK\":\"DKK\",\"DOP\":\"DOP\",\"XCD\":\"XCD\",\"EGP\":\"EGP\",\"EUR\":\"EUR\",\"FJD\":\"FJD\",\"GTQ\":\"GTQ\",\"HKD\":\"HKD\",\"HNL\":\"HNL\",\"HUF\":\"HUF\",\"INR\":\"INR\",\"IDR\":\"IDR\",\"ILS\":\"ILS\",\"JMD\":\"JMD\",\"JPY\":\"JPY\",\"KZT\":\"KZT\",\"KES\":\"KES\",\"LAK\":\"LAK\",\"MMK\":\"MMK\",\"LBP\":\"LBP\",\"LRD\":\"LRD\",\"MOP\":\"MOP\",\"MYR\":\"MYR\",\"MVR\":\"MVR\",\"MRO\":\"MRO\",\"MUR\":\"MUR\",\"MXN\":\"MXN\",\"MAD\":\"MAD\",\"NPR\":\"NPR\",\"TWD\":\"TWD\",\"NZD\":\"NZD\",\"NIO\":\"NIO\",\"NOK\":\"NOK\",\"PKR\":\"PKR\",\"PGK\":\"PGK\",\"PEN\":\"PEN\",\"PHP\":\"PHP\",\"PLN\":\"PLN\",\"QAR\":\"QAR\",\"RON\":\"RON\",\"RUB\":\"RUB\",\"WST\":\"WST\",\"SAR\":\"SAR\",\"SCR\":\"SCR\",\"SGD\":\"SGD\",\"SBD\":\"SBD\",\"ZAR\":\"ZAR\",\"KRW\":\"KRW\",\"LKR\":\"LKR\",\"SEK\":\"SEK\",\"CHF\":\"CHF\",\"SYP\":\"SYP\",\"THB\":\"THB\",\"TOP\":\"TOP\",\"TTD\":\"TTD\",\"TRY\":\"TRY\",\"UAH\":\"UAH\",\"AED\":\"AED\",\"USD\":\"USD\",\"VUV\":\"VUV\",\"VND\":\"VND\",\"XOF\":\"XOF\",\"YER\":\"YER\"}}', '{\"approved_url\":\"ipn\"}', '[\"AFN\",\"ARS\"]', '[{\"name\":\"AFN\",\"currency_symbol\":\"AFN\",\"conversion_rate\":\"0.63\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"ARS\",\"currency_symbol\":\"ARS\",\"conversion_rate\":\"3.24\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(14, 'authorizenet', 'Authorize.Net', 7, 'gateway/kY6uyYr0nPgU0SyM69Yy4ei7aAowCu.avif', 'local', 0, '{\"login_id\":\"\",\"current_transaction_key\":\"\"}', '{\"0\":{\"AUD\":\"AUD\",\"CAD\":\"CAD\",\"CHF\":\"CHF\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"NOK\":\"NOK\",\"NZD\":\"NZD\",\"PLN\":\"PLN\",\"SEK\":\"SEK\",\"USD\":\"USD\"}}', NULL, '[\"AUD\",\"CAD\"]', '[{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.014\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"},{\"name\":\"CAD\",\"currency_symbol\":\"CAD\",\"conversion_rate\":\"0.012\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0.5\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'test', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(15, 'securionpay', 'SecurionPay', 33, 'gateway/MZexTcUjZftszr1jA2xG9y8ntD2bA2.avif', 'local', 0, '{\"public_key\":\"\",\"secret_key\":\"\"}', '{\"0\":{\"AFN\":\"AFN\", \"DZD\":\"DZD\", \"ARS\":\"ARS\", \"AUD\":\"AUD\", \"BHD\":\"BHD\", \"BDT\":\"BDT\", \"BYR\":\"BYR\", \"BAM\":\"BAM\", \"BWP\":\"BWP\", \"BRL\":\"BRL\", \"BND\":\"BND\", \"BGN\":\"BGN\", \"CAD\":\"CAD\", \"CLP\":\"CLP\", \"CNY\":\"CNY\", \"COP\":\"COP\", \"KMF\":\"KMF\", \"HRK\":\"HRK\", \"CZK\":\"CZK\", \"DKK\":\"DKK\", \"DJF\":\"DJF\", \"DOP\":\"DOP\", \"EGP\":\"EGP\", \"ETB\":\"ETB\", \"ERN\":\"ERN\", \"EUR\":\"EUR\", \"GEL\":\"GEL\", \"HKD\":\"HKD\", \"HUF\":\"HUF\", \"ISK\":\"ISK\", \"INR\":\"INR\", \"IDR\":\"IDR\", \"IRR\":\"IRR\", \"IQD\":\"IQD\", \"ILS\":\"ILS\", \"JMD\":\"JMD\", \"JPY\":\"JPY\", \"JOD\":\"JOD\", \"KZT\":\"KZT\", \"KES\":\"KES\", \"KWD\":\"KWD\", \"KGS\":\"KGS\", \"LVL\":\"LVL\", \"LBP\":\"LBP\", \"LTL\":\"LTL\", \"MOP\":\"MOP\", \"MKD\":\"MKD\", \"MGA\":\"MGA\", \"MWK\":\"MWK\", \"MYR\":\"MYR\", \"MUR\":\"MUR\", \"MXN\":\"MXN\", \"MDL\":\"MDL\", \"MAD\":\"MAD\", \"MZN\":\"MZN\", \"NAD\":\"NAD\", \"NPR\":\"NPR\", \"ANG\":\"ANG\", \"NZD\":\"NZD\", \"NOK\":\"NOK\", \"OMR\":\"OMR\", \"PKR\":\"PKR\", \"PEN\":\"PEN\", \"PHP\":\"PHP\", \"PLN\":\"PLN\", \"QAR\":\"QAR\", \"RON\":\"RON\", \"RUB\":\"RUB\", \"SAR\":\"SAR\", \"RSD\":\"RSD\", \"SGD\":\"SGD\", \"ZAR\":\"ZAR\", \"KRW\":\"KRW\", \"IKR\":\"IKR\", \"LKR\":\"LKR\", \"SEK\":\"SEK\", \"CHF\":\"CHF\", \"SYP\":\"SYP\", \"TWD\":\"TWD\", \"TZS\":\"TZS\", \"THB\":\"THB\", \"TND\":\"TND\", \"TRY\":\"TRY\", \"UAH\":\"UAH\", \"AED\":\"AED\", \"GBP\":\"GBP\", \"USD\":\"USD\", \"VEB\":\"VEB\", \"VEF\":\"VEF\", \"VND\":\"VND\", \"XOF\":\"XOF\", \"YER\":\"YER\", \"ZMK\":\"ZMK\"}}', NULL, '[\"AFN\",\"DZD\"]', '[{\"name\":\"AFN\",\"currency_symbol\":\"AFN\",\"conversion_rate\":\"0.63\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"},{\"name\":\"DZD\",\"currency_symbol\":\"DZD\",\"conversion_rate\":\"1.22\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(16, 'payumoney', 'PayUmoney', 28, 'gateway/TjSy1hfABIV2RzIRECRJcwmN04sGEh.avif', 'local', 0, '{\"merchant_key\":\"\",\"salt\":\"\"}', '{\"0\":{\"INR\":\"INR\"}}', NULL, '[\"INR\"]', '[{\"name\":\"INR\",\"currency_symbol\":\"INR\",\"conversion_rate\":\"0.76\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'test', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(17, 'mercadopago', 'Mercado Pago', 18, 'gateway/2UlZWhhkfVSWQepk1uBKecw4FrepZx.avif', 'local', 0, '{\"access_token\":\"\"}', '{\"0\":{\"ARS\":\"ARS\",\"BOB\":\"BOB\",\"BRL\":\"BRL\",\"CLF\":\"CLF\",\"CLP\":\"CLP\",\"COP\":\"COP\",\"CRC\":\"CRC\",\"CUC\":\"CUC\",\"CUP\":\"CUP\",\"DOP\":\"DOP\",\"EUR\":\"EUR\",\"GTQ\":\"GTQ\",\"HNL\":\"HNL\",\"MXN\":\"MXN\",\"NIO\":\"NIO\",\"PAB\":\"PAB\",\"PEN\":\"PEN\",\"PYG\":\"PYG\",\"USD\":\"USD\",\"UYU\":\"UYU\",\"VEF\":\"VEF\",\"VES\":\"VES\"}}', NULL, '[\"ARS\"]', '[{\"name\":\"ARS\",\"currency_symbol\":\"ARS\",\"conversion_rate\":\"3.24\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(18, 'coingate', 'Coingate', 19, 'gateway/uxKFypl7GtiL0YnJhshsLKyGzf2YKt.avif', 'local', 0, '{\"api_key\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"EUR\":\"EUR\"}}', NULL, '[\"USD\",\"EUR\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"EUR\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0083\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'test', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(19, 'coinbasecommerce', 'Coinbase Commerce', 16, 'gateway/POaHQGEUctnNpM9YgAvIIwq0R9aXnw.avif', 'local', 0, '{\"api_key\":\"\",\"secret\":\"\"}', '{\"0\":{\"AED\":\"AED\",\"AFN\":\"AFN\",\"ALL\":\"ALL\",\"AMD\":\"AMD\",\"ANG\":\"ANG\",\"AOA\":\"AOA\",\"ARS\":\"ARS\",\"AUD\":\"AUD\",\"AWG\":\"AWG\",\"AZN\":\"AZN\",\"BAM\":\"BAM\",\"BBD\":\"BBD\",\"BDT\":\"BDT\",\"BGN\":\"BGN\",\"BHD\":\"BHD\",\"BIF\":\"BIF\",\"BMD\":\"BMD\",\"BND\":\"BND\",\"BOB\":\"BOB\",\"BRL\":\"BRL\",\"BSD\":\"BSD\",\"BTN\":\"BTN\",\"BWP\":\"BWP\",\"BYN\":\"BYN\",\"BZD\":\"BZD\",\"CAD\":\"CAD\",\"CDF\":\"CDF\",\"CHF\":\"CHF\",\"CLF\":\"CLF\",\"CLP\":\"CLP\",\"CNY\":\"CNY\",\"COP\":\"COP\",\"CRC\":\"CRC\",\"CUC\":\"CUC\",\"CUP\":\"CUP\",\"CVE\":\"CVE\",\"CZK\":\"CZK\",\"DJF\":\"DJF\",\"DKK\":\"DKK\",\"DOP\":\"DOP\",\"DZD\":\"DZD\",\"EGP\":\"EGP\",\"ERN\":\"ERN\",\"ETB\":\"ETB\",\"EUR\":\"EUR\",\"FJD\":\"FJD\",\"FKP\":\"FKP\",\"GBP\":\"GBP\",\"GEL\":\"GEL\",\"GGP\":\"GGP\",\"GHS\":\"GHS\",\"GIP\":\"GIP\",\"GMD\":\"GMD\",\"GNF\":\"GNF\",\"GTQ\":\"GTQ\",\"GYD\":\"GYD\",\"HKD\":\"HKD\",\"HNL\":\"HNL\",\"HRK\":\"HRK\",\"HTG\":\"HTG\",\"HUF\":\"HUF\",\"IDR\":\"IDR\",\"ILS\":\"ILS\",\"IMP\":\"IMP\",\"INR\":\"INR\",\"IQD\":\"IQD\",\"IRR\":\"IRR\",\"ISK\":\"ISK\",\"JEP\":\"JEP\",\"JMD\":\"JMD\",\"JOD\":\"JOD\",\"JPY\":\"JPY\",\"KES\":\"KES\",\"KGS\":\"KGS\",\"KHR\":\"KHR\",\"KMF\":\"KMF\",\"KPW\":\"KPW\",\"KRW\":\"KRW\",\"KWD\":\"KWD\",\"KYD\":\"KYD\",\"KZT\":\"KZT\",\"LAK\":\"LAK\",\"LBP\":\"LBP\",\"LKR\":\"LKR\",\"LRD\":\"LRD\",\"LSL\":\"LSL\",\"LYD\":\"LYD\",\"MAD\":\"MAD\",\"MDL\":\"MDL\",\"MGA\":\"MGA\",\"MKD\":\"MKD\",\"MMK\":\"MMK\",\"MNT\":\"MNT\",\"MOP\":\"MOP\",\"MRO\":\"MRO\",\"MUR\":\"MUR\",\"MVR\":\"MVR\",\"MWK\":\"MWK\",\"MXN\":\"MXN\",\"MYR\":\"MYR\",\"MZN\":\"MZN\",\"NAD\":\"NAD\",\"NGN\":\"NGN\",\"NIO\":\"NIO\",\"NOK\":\"NOK\",\"NPR\":\"NPR\",\"NZD\":\"NZD\",\"OMR\":\"OMR\",\"PAB\":\"PAB\",\"PEN\":\"PEN\",\"PGK\":\"PGK\",\"PHP\":\"PHP\",\"PKR\":\"PKR\",\"PLN\":\"PLN\",\"PYG\":\"PYG\",\"QAR\":\"QAR\",\"RON\":\"RON\",\"RSD\":\"RSD\",\"RUB\":\"RUB\",\"RWF\":\"RWF\",\"SAR\":\"SAR\",\"SBD\":\"SBD\",\"SCR\":\"SCR\",\"SDG\":\"SDG\",\"SEK\":\"SEK\",\"SGD\":\"SGD\",\"SHP\":\"SHP\",\"SLL\":\"SLL\",\"SOS\":\"SOS\",\"SRD\":\"SRD\",\"SSP\":\"SSP\",\"STD\":\"STD\",\"SVC\":\"SVC\",\"SYP\":\"SYP\",\"SZL\":\"SZL\",\"THB\":\"THB\",\"TJS\":\"TJS\",\"TMT\":\"TMT\",\"TND\":\"TND\",\"TOP\":\"TOP\",\"TRY\":\"TRY\",\"TTD\":\"TTD\",\"TWD\":\"TWD\",\"TZS\":\"TZS\",\"UAH\":\"UAH\",\"UGX\":\"UGX\",\"USD\":\"USD\",\"UYU\":\"UYU\",\"UZS\":\"UZS\",\"VEF\":\"VEF\",\"VND\":\"VND\",\"VUV\":\"VUV\",\"WST\":\"WST\",\"XAF\":\"XAF\",\"XAG\":\"XAG\",\"XAU\":\"XAU\",\"XCD\":\"XCD\",\"XDR\":\"XDR\",\"XOF\":\"XOF\",\"XPD\":\"XPD\",\"XPF\":\"XPF\",\"XPT\":\"XPT\",\"YER\":\"YER\",\"ZAR\":\"ZAR\",\"ZMW\":\"ZMW\",\"ZWL\":\"ZWL\"}}', '{\"webhook\":\"ipn\"}', '[\"AED\",\"ALL\"]', '[{\"name\":\"AED\",\"currency_symbol\":\"AED\",\"conversion_rate\":\"0.033\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"ALL\",\"currency_symbol\":\"ALL\",\"conversion_rate\":\"0.85\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(20, 'monnify', 'Monnify', 20, 'gateway/N9ZZ4F4YeYM4m78gZW0Gnm8HTu037v.avif', 'local', 0, '{\"api_key\":\"\",\"secret_key\":\"\",\"contract_code\":\"\"}', '{\"0\":{\"NGN\":\"NGN\"}}', NULL, '[\"NGN\"]', '[{\"name\":\"NGN\",\"currency_symbol\":\"NGN\",\"conversion_rate\":\"7.40\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(22, 'coinpayments', 'CoinPayments', 21, 'gateway/truY5ILTjTIFunGBf7Hn5vcWSxYw6Q.avif', 'local', 0, '{\"merchant_id\":\"\",\"private_key\":\"\",\"public_key\":\"\"}', '{\"0\":{\"USD\":\"USD\",\"AUD\":\"AUD\",\"BRL\":\"BRL\",\"CAD\":\"CAD\",\"CHF\":\"CHF\",\"CLP\":\"CLP\",\"CNY\":\"CNY\",\"DKK\":\"DKK\",\"EUR\":\"EUR\",\"GBP\":\"GBP\",\"HKD\":\"HKD\",\"INR\":\"INR\",\"ISK\":\"ISK\",\"JPY\":\"JPY\",\"KRW\":\"KRW\",\"NZD\":\"NZD\",\"PLN\":\"PLN\",\"RUB\":\"RUB\",\"SEK\":\"SEK\",\"SGD\":\"SGD\",\"THB\":\"THB\",\"TWD\":\"TWD\"},\"1\":{\"BTC\":\"Bitcoin\",\"BTC.LN\":\"Bitcoin (Lightning Network)\",\"LTC\":\"Litecoin\",\"CPS\":\"CPS Coin\",\"VLX\":\"Velas\",\"APL\":\"Apollo\",\"AYA\":\"Aryacoin\",\"BAD\":\"Badcoin\",\"BCD\":\"Bitcoin Diamond\",\"BCH\":\"Bitcoin Cash\",\"BCN\":\"Bytecoin\",\"BEAM\":\"BEAM\",\"BITB\":\"Bean Cash\",\"BLK\":\"BlackCoin\",\"BSV\":\"Bitcoin SV\",\"BTAD\":\"Bitcoin Adult\",\"BTG\":\"Bitcoin Gold\",\"BTT\":\"BitTorrent\",\"CLOAK\":\"CloakCoin\",\"CLUB\":\"ClubCoin\",\"CRW\":\"Crown\",\"CRYP\":\"CrypticCoin\",\"CRYT\":\"CryTrExCoin\",\"CURE\":\"CureCoin\",\"DASH\":\"DASH\",\"DCR\":\"Decred\",\"DEV\":\"DeviantCoin\",\"DGB\":\"DigiByte\",\"DOGE\":\"Dogecoin\",\"EBST\":\"eBoost\",\"EOS\":\"EOS\",\"ETC\":\"Ether Classic\",\"ETH\":\"Ethereum\",\"ETN\":\"Electroneum\",\"EUNO\":\"EUNO\",\"EXP\":\"EXP\",\"Expanse\":\"Expanse\",\"FLASH\":\"FLASH\",\"GAME\":\"GameCredits\",\"GLC\":\"Goldcoin\",\"GRS\":\"Groestlcoin\",\"KMD\":\"Komodo\",\"LOKI\":\"LOKI\",\"LSK\":\"LSK\",\"MAID\":\"MaidSafeCoin\",\"MUE\":\"MonetaryUnit\",\"NAV\":\"NAV Coin\",\"NEO\":\"NEO\",\"NMC\":\"Namecoin\",\"NVST\":\"NVO Token\",\"NXT\":\"NXT\",\"OMNI\":\"OMNI\",\"PINK\":\"PinkCoin\",\"PIVX\":\"PIVX\",\"POT\":\"PotCoin\",\"PPC\":\"Peercoin\",\"PROC\":\"ProCurrency\",\"PURA\":\"PURA\",\"QTUM\":\"QTUM\",\"RES\":\"Resistance\",\"RVN\":\"Ravencoin\",\"RVR\":\"RevolutionVR\",\"SBD\":\"Steem Dollars\",\"SMART\":\"SmartCash\",\"SOXAX\":\"SOXAX\",\"STEEM\":\"STEEM\",\"STRAT\":\"STRAT\",\"SYS\":\"Syscoin\",\"TPAY\":\"TokenPay\",\"TRIGGERS\":\"Triggers\",\"TRX\":\" TRON\",\"UBQ\":\"Ubiq\",\"UNIT\":\"UniversalCurrency\",\"USDT\":\"Tether USD (Omni Layer)\",\"VTC\":\"Vertcoin\",\"WAVES\":\"Waves\",\"XCP\":\"Counterparty\",\"XEM\":\"NEM\",\"XMR\":\"Monero\",\"XSN\":\"Stakenet\",\"XSR\":\"SucreCoin\",\"XVG\":\"VERGE\",\"XZC\":\"ZCoin\",\"ZEC\":\"ZCash\",\"ZEN\":\"Horizen\"}}', '{\"callback\":\"ipn\"}', '[\"USD\",\"AUD\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"AUD\",\"currency_symbol\":\"AUD\",\"conversion_rate\":\"0.014\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(23, 'blockchain', 'Blockchain', 24, 'gateway/20zn8YG4VPgOUSBQHvj0GeKMHwL4ZY.avif', 'local', 0, '{\"api_key\":\"\",\"xpub_code\":\"\"}', '{\"1\":{\"BTC\":\"BTC\"}}', NULL, '[\"BTC\"]', '[{\"name\":\"BTC\",\"currency_symbol\":\"BTC\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"50\",\"max_limit\":\"500000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 0, 0, 'live', NULL, NULL, '2020-09-10 03:05:02', '2024-11-20 05:22:14'),
(25, 'cashmaal', 'cashmaal', 25, 'gateway/7Y3IZE7VY61XHwNxRzrgWVFZx8zUu0.avif', 'local', 0, '{\"web_id\":\"\",\"ipn_key\":\"\"}', '{\"0\":{\"PKR\":\"PKR\",\"USD\":\"USD\"}}', '{\"ipn_url\":\"ipn\"}', '[\"PKR\",\"USD\"]', '[{\"name\":\"PKR\",\"currency_symbol\":\"PKR\",\"conversion_rate\":\"2.56\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, NULL, '2024-11-20 05:22:14'),
(26, 'midtrans', 'Midtrans', 2, 'gateway/7fRFCClfGcMefCb35AVzgnEJevUi37.avif', 'local', 0, '{\"client_key\":\"\",\"server_key\":\"\"}', '{\"0\":{\"IDR\":\"IDR\"}}', '{\"payment_notification_url\":\"ipn\", \"finish redirect_url\":\"ipn\", \"unfinish redirect_url\":\"failed\",\"error redirect_url\":\"failed\"}', '[\"IDR\"]', '[{\"name\":\"IDR\",\"currency_symbol\":\"IDR\",\"conversion_rate\":\"141.38\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'test', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(27, 'peachpayments', 'peachpayments', 35, 'gateway/4aJggeZFR2SBLYMw9DewRUOByPaRez.avif', 'local', 0, '{\"Authorization_Bearer\":\"\",\"Entity_ID\":\"\",\"Recur_Channel\":\"\"}', '{\"0\":{\"AED\":\"AED\",\"AFA\":\"AFA\",\"AMD\":\"AMD\",\"ANG\":\"ANG\",\"AOA\":\"AOA\",\"ARS\":\"ARS\",\"AUD\":\"AUD\",\"AWG\":\"AWG\",\"AZM\":\"AZM\",\"BAM\":\"BAM\",\"BBD\":\"BBD\",\"BDT\":\"BDT\",\"BGN\":\"BGN\",\"BHD\":\"BHD\",\"BIF\":\"BIF\",\"BMD\":\"BMD\",\"BND\":\"BND\",\"BOB\":\"BOB\",\"BRL\":\"BRL\",\"BSD\":\"BSD\",\"BTN\":\"BTN\",\"BWP\":\"BWP\",\"BYR\":\"BYR\",\"BZD\":\"BZD\",\"CAD\":\"CAD\",\"CDF\":\"CDF\",\"CHF\":\"CHF\",\"CLP\":\"CLP\",\"CNY\":\"CNY\",\"COP\":\"COP\",\"CRC\":\"CRC\",\"CUP\":\"CUP\",\"CVE\":\"CVE\",\"CYP\":\"CYP\",\"CZK\":\"CZK\",\"DJF\":\"DJF\",\"DKK\":\"DKK\",\"DOP\":\"DOP\",\"DZD\":\"DZD\",\"EEK\":\"EEK\",\"EGP\":\"EGP\",\"ERN\":\"ERN\",\"ETB\":\"ETB\",\"EUR\":\"EUR\",\"FJD\":\"FJD\",\"FKP\":\"FKP\",\"GBP\":\"GBP\",\"GEL\":\"GEL\",\"GGP\":\"GGP\",\"GHC\":\"GHC\",\"GIP\":\"GIP\",\"GMD\":\"GMD\",\"GNF\":\"GNF\",\"GTQ\":\"GTQ\",\"GYD\":\"GYD\",\"HKD\":\"HKD\",\"HNL\":\"HNL\",\"HRK\":\"HRK\",\"HTG\":\"HTG\",\"HUF\":\"HUF\",\"IDR\":\"IDR\",\"ILS\":\"ILS\",\"IMP\":\"IMP\",\"INR\":\"INR\",\"IQD\":\"IQD\",\"IRR\":\"IRR\",\"ISK\":\"ISK\",\"JEP\":\"JEP\",\"JMD\":\"JMD\",\"JOD\":\"JOD\",\"JPY\":\"JPY\",\"KES\":\"KES\",\"KGS\":\"KGS\",\"KHR\":\"KHR\",\"KMF\":\"KMF\",\"KPW\":\"KPW\",\"KRW\":\"KRW\",\"KWD\":\"KWD\",\"KYD\":\"KYD\",\"KZT\":\"KZT\",\"LAK\":\"LAK\",\"LBP\":\"LBP\",\"LKR\":\"LKR\",\"LRD\":\"LRD\",\"LSL\":\"LSL\",\"LTL\":\"LTL\",\"LVL\":\"LVL\",\"LYD\":\"LYD\",\"MAD\":\"MAD\",\"MDL\":\"MDL\",\"MGA\":\"MGA\",\"MKD\":\"MKD\",\"MMK\":\"MMK\",\"MNT\":\"MNT\",\"MOP\":\"MOP\",\"MRO\":\"MRO\",\"MTL\":\"MTL\",\"MUR\":\"MUR\",\"MVR\":\"MVR\",\"MWK\":\"MWK\",\"MXN\":\"MXN\",\"MYR\":\"MYR\",\"MZM\":\"MZM\",\"NAD\":\"NAD\",\"NGN\":\"NGN\",\"NIO\":\"NIO\",\"NOK\":\"NOK\",\"NPR\":\"NPR\",\"NZD\":\"NZD\",\"OMR\":\"OMR\",\"PAB\":\"PAB\",\"PEN\":\"PEN\",\"PGK\":\"PGK\",\"PHP\":\"PHP\",\"PKR\":\"PKR\",\"PLN\":\"PLN\",\"PTS\":\"PTS\",\"PYG\":\"PYG\",\"QAR\":\"QAR\",\"RON\":\"RON\",\"RUB\":\"RUB\",\"RWF\":\"RWF\",\"SAR\":\"SAR\",\"SBD\":\"SBD\",\"SCR\":\"SCR\",\"SDD\":\"SDD\",\"SEK\":\"SEK\",\"SGD\":\"SGD\",\"SHP\":\"SHP\",\"SIT\":\"SIT\",\"SKK\":\"SKK\",\"SLL\":\"SLL\",\"SOS\":\"SOS\",\"SPL\":\"SPL\",\"SRD\":\"SRD\",\"STD\":\"STD\",\"SVC\":\"SVC\",\"SYP\":\"SYP\",\"SZL\":\"SZL\",\"THB\":\"THB\",\"TJS\":\"TJS\",\"TMM\":\"TMM\",\"TND\":\"TND\",\"TOP\":\"TOP\",\"TRL\":\"TRL\",\"TRY\":\"TRY\",\"TTD\":\"TTD\",\"TVD\":\"TVD\",\"TWD\":\"TWD\",\"TZS\":\"TZS\",\"UAH\":\"UAH\",\"UGX\":\"UGX\",\"USD\":\"USD\",\"UYU\":\"UYU\",\"UZS\":\"UZS\",\"VEF\":\"VEF\",\"VND\":\"VND\",\"VUV\":\"VUV\",\"WST\":\"WST\",\"XAF\":\"XAF\",\"XAG\":\"XAG\",\"XAU\":\"XAU\",\"XCD\":\"XCD\",\"XDR\":\"XDR\",\"XOF\":\"XOF\",\"XPD\":\"XPD\",\"XPF\":\"XPF\",\"XPT\":\"XPT\",\"YER\":\"YER\",\"ZAR\":\"ZAR\",\"ZMK\":\"ZMK\",\"ZWD\":\"ZWD\"}}', NULL, '[\"CAD\",\"AED\"]', '[{\"name\":\"CAD\",\"currency_symbol\":\"CAD\",\"conversion_rate\":\"0.012\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"AED\",\"currency_symbol\":\"AED\",\"conversion_rate\":\"0.033\",\"min_limit\":\"1\",\"max_limit\":\"10000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, '', '2020-09-09 03:05:02', '2024-11-20 05:22:14'),
(28, 'nowpayments', 'Nowpayments', 26, 'gateway/Z5wvvbRZN7nZUC6GgPTqMyf1lM2WBf.avif', 'local', 0, '{\"api_key\":\"\"}', '{\"1\":{\"BTG\":\"BTG\",\"ETH\":\"ETH\",\"XMR\":\"XMR\",\"ZEC\":\"ZEC\",\"XVG\":\"XVG\",\"ADA\":\"ADA\",\"LTC\":\"LTC\",\"BCH\":\"BCH\",\"QTUM\":\"QTUM\",\"DASH\":\"DASH\",\"XLM\":\"XLM\",\"XRP\":\"XRP\",\"XEM\":\"XEM\",\"DGB\":\"DGB\",\"LSK\":\"LSK\",\"DOGE\":\"DOGE\",\"TRX\":\"TRX\",\"KMD\":\"KMD\",\"REP\":\"REP\",\"BAT\":\"BAT\",\"ARK\":\"ARK\",\"WAVES\":\"WAVES\",\"BNB\":\"BNB\",\"XZC\":\"XZC\",\"NANO\":\"NANO\",\"TUSD\":\"TUSD\",\"VET\":\"VET\",\"ZEN\":\"ZEN\",\"GRS\":\"GRS\",\"FUN\":\"FUN\",\"NEO\":\"NEO\",\"GAS\":\"GAS\",\"PAX\":\"PAX\",\"USDC\":\"USDC\",\"ONT\":\"ONT\",\"XTZ\":\"XTZ\",\"LINK\":\"LINK\",\"RVN\":\"RVN\",\"BNBMAINNET\":\"BNBMAINNET\",\"ZIL\":\"ZIL\",\"BCD\":\"BCD\",\"USDT\":\"USDT\",\"USDTERC20\":\"USDTERC20\",\"CRO\":\"CRO\",\"DAI\":\"DAI\",\"HT\":\"HT\",\"WABI\":\"WABI\",\"BUSD\":\"BUSD\",\"ALGO\":\"ALGO\",\"USDTTRC20\":\"USDTTRC20\",\"GT\":\"GT\",\"STPT\":\"STPT\",\"AVA\":\"AVA\",\"SXP\":\"SXP\",\"UNI\":\"UNI\",\"OKB\":\"OKB\",\"BTC\":\"BTC\"}}', '{\"cron\":\"ipn\"}', '[\"ETH\",\"XEM\"]', '[{\"name\":\"ETH\",\"currency_symbol\":\"XEM\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"10\",\"max_limit\":\"500000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"},{\"name\":\"XEM\",\"currency_symbol\":\"ETH\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"10\",\"max_limit\":\"500000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 0, 1, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(29, 'khalti', 'Khalti Payment', 29, 'gateway/x4BeAPBkYuM494NvWfAkrxTfk1tbUt.avif', 'local', 0, '{\"secret_key\":\"\",\"public_key\":\"\"}', '{\"0\":{\"NPR\":\"NPR\"}}', NULL, '[\"NPR\"]', '[{\"name\":\"NPR\",\"currency_symbol\":\"NPR\",\"conversion_rate\":\"1.21\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(30, 'swagger', 'MAGUA PAY', 22, 'gateway/j8bFL5e5LOn6YkquKQiy6com8w1uj2.avif', 'local', 0, '{\"MAGUA_PAY_ACCOUNT\":\"\",\"MerchantKey\":\"\",\"Secret\":\"\"}', '{\"0\":{\"EUR\":\"EUR\"}}', NULL, '[\"EUR\"]', '[{\"name\":\"EUR\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0083\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(31, 'freekassa', 'Free kassa', 36, 'gateway/VqJR12ZLuhmisIpUbpm6p2OCqm4hHC.avif', 'local', 0, '{\"merchant_id\":\"\",\"merchant_key\":\"\",\"secret_word\":\"\",\"secret_word2\":\"\"}', '{\"0\":{\"RUB\":\"RUB\",\"USD\":\"USD\",\"EUR\":\"EUR\",\"UAH\":\"UAH\",\"KZT\":\"KZT\"}}', '{\"ipn_url\":\"ipn\"}', '[\"RUB\",\"USD\"]', '[{\"name\":\"RUB\",\"currency_symbol\":\"RUB\",\"conversion_rate\":\"0.81\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(32, 'konnect', 'Konnect', 30, 'gateway/DIWitJin1UBjkwTLrSPcstnUDGmTz3.avif', 'local', 0, '{\"api_key\":\"\",\"receiver_wallet_Id\":\"\"}', '{\"0\":{\"TND\":\"TND\",\"EUR\":\"EUR\",\"USD\":\"USD\"}}', '{\"webhook\":\"ipn\"}', '[\"USD\",\"TND\",\"EUR\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"name\":\"TND\",\"currency_symbol\":\"TND\",\"conversion_rate\":\"0.028\",\"min_limit\":\"1\",\"max_limit\":\"20000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"},{\"name\":\"EUR\",\"currency_symbol\":\"EUR\",\"conversion_rate\":\"0.0083\",\"min_limit\":\"1\",\"max_limit\":\"60000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(33, 'mypay', 'Mypay Np', 32, 'gateway/kkBeSnA5MFdlLrrSOpF3dJp1JwMxIB.avif', 'local', 0, '{\"merchant_username\":\"\",\"merchant_api_password\":\"\",\"merchant_id\":\"\",\"api_key\":\"\"}', '{\"0\":{\"NPR\":\"NPR\"}}', NULL, '[\"NPR\"]', '[{\"name\":\"NPR\",\"currency_symbol\":\"NPR\",\"conversion_rate\":\"1.21\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 1, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(35, 'imepay', 'IME PAY', 9, 'gateway/YuBFrsBWuxf17sqB6z8y039xgdxyat.avif', 'local', 0, '{\"MerchantModule\":\"\",\"MerchantCode\":\"\",\"username\":\"\",\"password\":\"\"}', '{\"0\":{\"NPR\":\"NPR\"}}', NULL, '[\"NPR\"]', '[{\"name\":\"NPR\",\"currency_symbol\":\"NPR\",\"conversion_rate\":\"1.21\",\"min_limit\":\"10\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"1.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, '', '2020-09-08 21:05:02', '2024-11-20 05:22:14'),
(36, 'cashonexHosted', 'Cashonex Hosted', 14, 'gateway/GAcL1CamWpPaeDGaD6aSInqXknXK50.avif', 'local', 0, '{\"idempotency_key\":\"\",\"salt\":\"\"}', '{\"0\":{\"USD\":\"USD\"}}', NULL, '[\"USD\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2023-04-02 18:31:33', '2024-11-20 05:22:14'),
(37, 'cashonex', 'cashonex', 31, 'gateway/rbbey8zLDMKdNPftwRdOSY79eVEGLi.avif', 'local', 0, '{\"idempotency_key\":\"\",\"salt\":\"\"}', '{\"0\":{\"USD\":\"USD\"}}', NULL, '[\"USD\"]', '[{\"name\":\"USD\",\"currency_symbol\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"1\",\"max_limit\":\"15000\",\"percentage_charge\":\"0.0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, NULL, '2023-04-02 18:34:54', '2024-11-20 05:22:14'),
(38, 'binance', 'Binance', 12, 'gateway/bZ7w2koAzATHG9gp8k6JzRhhusXTpH.avif', 'local', 0, '{\"mercent_api_key\":\"\",\"mercent_secret\":\"\"}', '{\"1\":{\"ADA\":\"ADA\",\"ATOM\":\"ATOM\",\"AVA\":\"AVA\",\"BCH\":\"BCH\",\"BNB\":\"BNB\",\"BTC\":\"BTC\",\"BUSD\":\"BUSD\",\"CTSI\":\"CTSI\",\"DASH\":\"DASH\",\"DOGE\":\"DOGE\",\"DOT\":\"DOT\",\"EGLD\":\"EGLD\",\"EOS\":\"EOS\",\"ETC\":\"ETC\",\"ETH\":\"ETH\",\"FIL\":\"FIL\",\"FRONT\":\"FRONT\",\"FTM\":\"FTM\",\"GRS\":\"GRS\",\"HBAR\":\"HBAR\",\"IOTX\":\"IOTX\",\"LINK\":\"LINK\",\"LTC\":\"LTC\",\"MANA\":\"MANA\",\"MATIC\":\"MATIC\",\"NEO\":\"NEO\",\"OM\":\"OM\",\"ONE\":\"ONE\",\"PAX\":\"PAX\",\"QTUM\":\"QTUM\",\"STRAX\":\"STRAX\",\"SXP\":\"SXP\",\"TRX\":\"TRX\",\"TUSD\":\"TUSD\",\"UNI\":\"UNI\",\"USDC\":\"USDC\",\"USDT\":\"USDT\",\"WRX\":\"WRX\",\"XLM\":\"XLM\",\"XMR\":\"XMR\",\"XRP\":\"XRP\",\"XTZ\":\"XTZ\",\"XVS\":\"XVS\",\"ZEC\":\"ZEC\",\"ZIL\":\"ZIL\"}}', NULL, '[\"BTC\"]', '[{\"name\":\"BTC\",\"currency_symbol\":\"BTC\",\"conversion_rate\":\"0.000027\",\"min_limit\":\"1\",\"max_limit\":\"5\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 0, 0, 'live', NULL, NULL, '2023-04-02 19:36:14', '2024-11-20 05:22:14'),
(39, 'cinetpay', 'CinetPay ', 37, 'gateway/9WCd4Kn4EvlDX8y4V3bEV7eazCTlla.avif', 'local', 0, '{\"apiKey\":\"\",\"site_id\":\"\"}', '{\"0\":{\"XOF\":\"XOF\",\"XAF\":\"XAF\",\"CDF\":\"CDF\",\"GNF\":\"GNF\",\"USD\":\"USD\"}}', 'NULL', '[\"XOF\"]', '[{\"name\":\"XOF\",\"currency_symbol\":\"XOF\",\"conversion_rate\":\"5.45\",\"min_limit\":\"1\",\"max_limit\":\"50000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'test', NULL, NULL, '2023-04-02 19:36:14', '2024-11-20 05:22:14'),
(1000, 'bank-transfer', 'Bank Transfer', 1, 'gateway/A2zYpiPKpPWcByCCys7mpnCugQEHvv.avif', 'local', 1, '{\"AccountNumber\":{\"field_name\":\"AccountNumber\",\"field_label\":\"Account Number\",\"type\":\"text\",\"validation\":\"required\"},\"BeneficiaryName\":{\"field_name\":\"BeneficiaryName\",\"field_label\":\"Beneficiary Name\",\"type\":\"text\",\"validation\":\"required\"},\"NID\":{\"field_name\":\"NID\",\"field_label\":\"NID\",\"type\":\"file\",\"validation\":\"required\"},\"Address\":{\"field_name\":\"Address\",\"field_label\":\"Address\",\"type\":\"text\",\"validation\":\"required\"}}', NULL, NULL, '[\"USD\",\"EUR\"]', '[{\"currency\":\"USD\",\"conversion_rate\":\"0.0091\",\"min_limit\":\"0.2\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"},{\"currency\":\"EUR\",\"conversion_rate\":\"0.0086\",\"min_limit\":\"1\",\"max_limit\":\"100000\",\"percentage_charge\":\"0\",\"fixed_charge\":\"0.5\"}]', 'Send form your payment gateway. your bank may charge you a cash advance fee.', 1, 0, 'live', NULL, 'Send form your payment gateway. your bank may charge you a cash advance fee.Send form your payment gateway. your bank may charge you a cash advance fee.Send form your payment gateway. your bank may charge you a cash advance fee.Send form your payment gateway. your bank may charge you a cash advance fee.Send form your payment gateway. your bank may charge you a cash advance fee.', NULL, '2024-03-12 11:06:25');

-- --------------------------------------------------------

--
-- Table structure for table `in_app_notifications`
--

CREATE TABLE `in_app_notifications` (
  `id` int(11) UNSIGNED NOT NULL,
  `in_app_notificationable_id` int(11) NOT NULL,
  `in_app_notificationable_type` varchar(191) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `jobs`
--

CREATE TABLE `jobs` (
  `id` int(11) UNSIGNED NOT NULL,
  `queue` varchar(191) NOT NULL,
  `payload` longtext NOT NULL,
  `attempts` tinyint(3) UNSIGNED NOT NULL,
  `reserved_at` int(10) UNSIGNED DEFAULT NULL,
  `available_at` int(10) UNSIGNED NOT NULL,
  `created_at` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `jobs`
--

INSERT INTO `jobs` (`id`, `queue`, `payload`, `attempts`, `reserved_at`, `available_at`, `created_at`) VALUES
(166, 'default', '{\"uuid\":\"0d63d7bd-9949-485f-b85d-81460ecd4398\",\"displayName\":\"App\\\\Mail\\\\SendMail\",\"job\":\"Illuminate\\\\Queue\\\\CallQueuedHandler@call\",\"maxTries\":null,\"maxExceptions\":null,\"failOnTimeout\":false,\"backoff\":null,\"timeout\":null,\"retryUntil\":null,\"data\":{\"commandName\":\"Illuminate\\\\Mail\\\\SendQueuedMailable\",\"command\":\"O:34:\\\"Illuminate\\\\Mail\\\\SendQueuedMailable\\\":15:{s:8:\\\"mailable\\\";O:17:\\\"App\\\\Mail\\\\SendMail\\\":6:{s:10:\\\"from_email\\\";s:15:\\\"support@you.com\\\";s:10:\\\"site_title\\\";s:9:\\\"Coinectra\\\";s:7:\\\"subject\\\";s:27:\\\"You have a exchange request\\\";s:7:\\\"message\\\";s:125:\\\"<p> \\r\\nHello admin,<\\/p><p>\\r\\n\\r\\nAnonymous make a exchange request 0.5 BTC to 58.99792954 BCH. Transaction Id- E673c371451eef<\\/p>\\\";s:2:\\\"to\\\";a:1:{i:0;a:2:{s:4:\\\"name\\\";s:5:\\\"admin\\\";s:7:\\\"address\\\";s:18:\\\"ad213min@bug13.com\\\";}}s:6:\\\"mailer\\\";s:4:\\\"smtp\\\";}s:5:\\\"tries\\\";N;s:7:\\\"timeout\\\";N;s:13:\\\"maxExceptions\\\";N;s:17:\\\"shouldBeEncrypted\\\";b:0;s:10:\\\"connection\\\";N;s:5:\\\"queue\\\";N;s:15:\\\"chainConnection\\\";N;s:10:\\\"chainQueue\\\";N;s:19:\\\"chainCatchCallbacks\\\";N;s:5:\\\"delay\\\";N;s:11:\\\"afterCommit\\\";N;s:10:\\\"middleware\\\";a:0:{}s:7:\\\"chained\\\";a:0:{}s:3:\\\"job\\\";N;}\"}}', 0, NULL, 1731999741, 1731999741);

-- --------------------------------------------------------

--
-- Table structure for table `kycs`
--

CREATE TABLE `kycs` (
  `id` int(11) UNSIGNED NOT NULL,
  `name` varchar(191) DEFAULT NULL,
  `slug` varchar(191) DEFAULT NULL,
  `input_form` text DEFAULT NULL,
  `status` tinyint(1) DEFAULT 0 COMMENT '1 => Active, 0 => Inactive',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `kycs`
--

INSERT INTO `kycs` (`id`, `name`, `slug`, `input_form`, `status`, `created_at`, `updated_at`) VALUES
(14, 'NID Verification', 'nid-verification', '{\"Name\":{\"field_name\":\"Name\",\"field_label\":\"Name\",\"type\":\"text\",\"validation\":\"required\"},\"NidNumber\":{\"field_name\":\"NidNumber\",\"field_label\":\"Nid Number\",\"type\":\"number\",\"validation\":\"required\"},\"DateOfBirth\":{\"field_name\":\"DateOfBirth\",\"field_label\":\"Date Of Birth\",\"type\":\"date\",\"validation\":\"required\"}}', 0, '2023-10-17 07:08:02', '2023-10-17 07:10:06'),
(15, 'Address Verification', 'address-verification', '{\"Name\":{\"field_name\":\"Name\",\"field_label\":\"Name\",\"type\":\"text\",\"validation\":\"optional\"},\"FullAddress\":{\"field_name\":\"FullAddress\",\"field_label\":\"Full Address\",\"type\":\"textarea\",\"validation\":\"required\"},\"AddressProve\":{\"field_name\":\"AddressProve\",\"field_label\":\"Address Prove\",\"type\":\"file\",\"validation\":\"required\"}}', 0, '2023-10-17 07:09:08', '2023-10-17 07:09:08');

-- --------------------------------------------------------

--
-- Table structure for table `languages`
--

CREATE TABLE `languages` (
  `id` int(11) UNSIGNED NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `short_name` varchar(20) DEFAULT NULL,
  `flag` varchar(100) DEFAULT NULL,
  `flag_driver` varchar(20) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0 => Inactive, 1 => Active',
  `rtl` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 => Inactive, 1 => Active ',
  `default_status` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `languages`
--

INSERT INTO `languages` (`id`, `name`, `short_name`, `flag`, `flag_driver`, `status`, `rtl`, `default_status`, `created_at`, `updated_at`) VALUES
(1, 'English', 'en', 'language/mJPLAndu3pCSydXVCmxjVxr34dt2YnlAAqCvXi4W.jpg', 'local', 1, 0, 1, '2023-06-17 04:35:53', '2023-10-12 10:31:48');

-- --------------------------------------------------------

--
-- Table structure for table `maintenance_modes`
--

CREATE TABLE `maintenance_modes` (
  `id` int(11) UNSIGNED NOT NULL,
  `heading` varchar(191) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `image` varchar(191) DEFAULT NULL,
  `image_driver` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `maintenance_modes`
--

INSERT INTO `maintenance_modes` (`id`, `heading`, `description`, `image`, `image_driver`, `created_at`, `updated_at`) VALUES
(1, 'The website under maintenance!', 'We apologize for any inconvenience, but our website is currently undergoing scheduled maintenance to enhance your user experience. During this time, you may experience temporary disruptions in service.', 'maintenanceMode/3jXAnm42OZuYy3kVDcHKUjW3gyiG8eSo96rlgg19.png', 'local', '2023-10-04 04:44:32', '2024-01-21 10:56:53');

-- --------------------------------------------------------

--
-- Table structure for table `manage_menus`
--

CREATE TABLE `manage_menus` (
  `id` int(11) UNSIGNED NOT NULL,
  `menu_section` varchar(50) DEFAULT NULL,
  `menu_items` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `manage_menus`
--

INSERT INTO `manage_menus` (`id`, `menu_section`, `menu_items`, `created_at`, `updated_at`) VALUES
(3, 'header', '{\"0\":\"gogar\",\"1\":\"about\",\"2\":\"feature\",\"3\":\"blog\",\"4\":\"faq\",\"6\":\"contact\"}', '2023-10-15 20:54:10', '2024-04-01 21:03:24'),
(4, 'footer', '{\"useful_link\":[\"about\",\"faq\",\"blog\"],\"support_link\":[\"contact\",\"terms and conditions\",\"privacy policy\"]}', '2023-10-15 20:54:10', '2024-11-18 01:33:12');

-- --------------------------------------------------------

--
-- Table structure for table `manual_sms_configs`
--

CREATE TABLE `manual_sms_configs` (
  `id` int(11) UNSIGNED NOT NULL,
  `action_method` varchar(191) DEFAULT NULL,
  `action_url` varchar(191) DEFAULT NULL,
  `header_data` text DEFAULT NULL,
  `param_data` text DEFAULT NULL,
  `form_data` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `manual_sms_configs`
--

INSERT INTO `manual_sms_configs` (`id`, `action_method`, `action_url`, `header_data`, `param_data`, `form_data`, `created_at`, `updated_at`) VALUES
(1, 'POST', 'https://rest.nexmo.com/sms/json', '{\"Content-Type\":\"application\\/x-www-form-urlencoded\"}', NULL, '{\"from\":\"Rownak\",\"text\":\"[[message]]\",\"to\":\"[[receiver]]\",\"api_key\":\"930cc608\",\"api_secret\":\"2pijsaMOUw5YKOK5\"}', NULL, '2023-10-19 09:03:34');

-- --------------------------------------------------------

--
-- Table structure for table `migrations`
--

CREATE TABLE `migrations` (
  `id` int(10) UNSIGNED NOT NULL,
  `migration` varchar(191) NOT NULL,
  `batch` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `migrations`
--

INSERT INTO `migrations` (`id`, `migration`, `batch`) VALUES
(1, '2014_10_12_000000_create_users_table', 1),
(2, '2014_10_12_100000_create_password_reset_tokens_table', 1),
(3, '2019_08_19_000000_create_failed_jobs_table', 1),
(4, '2019_12_14_000001_create_personal_access_tokens_table', 1),
(5, '2023_06_07_064911_create_admins_table', 2),
(6, '2014_10_12_100000_create_password_resets_table', 3),
(7, '2023_06_10_061241_create_basic_controls_table', 4),
(8, '2023_06_10_123329_create_file_storages_table', 4),
(9, '2023_06_15_102426_create_firebase_notifies_table', 5),
(10, '2023_06_17_085447_create_languages_table', 6),
(11, '2023_06_19_082042_create_sms_controls_table', 7),
(12, '2023_06_20_080624_create_support_tickets_table', 8),
(13, '2023_06_20_080731_create_support_ticket_messages_table', 8),
(14, '2023_06_20_080833_create_support_ticket_attachments_table', 8),
(15, '2023_06_20_212143_create_fire_base_tokens_table', 9),
(16, '2023_06_21_124322_create_in_app_notifications_table', 10),
(17, '2023_06_22_084256_create_gateways_table', 11),
(18, '2023_07_15_162549_create_kycs_table', 12),
(19, '2023_07_17_094844_create_manage_pages_table', 13),
(20, '2023_07_17_101515_create_manage_sections_table', 14),
(21, '2023_07_18_084411_create_pages_table', 15),
(22, '2023_07_22_130913_create_manage_menus_table', 16),
(23, '2023_07_26_193156_create_email_controls_table', 17),
(24, '2023_08_10_153005_create_google_sheet_apis_table', 18),
(25, '2023_08_20_140757_create_contents_table', 19),
(26, '2023_08_20_140808_create_content_details_table', 19),
(27, '2023_08_20_140815_create_content_media_table', 19),
(28, '2023_09_07_151706_create_user_logins_table', 20),
(29, '2023_09_09_105217_create_transactions_table', 21),
(30, '2023_09_09_105305_create_payout_logs_table', 21),
(31, '2023_09_09_105353_create_funds_table', 21),
(32, '2023_09_19_131540_create_deposits_table', 22),
(33, '2023_09_20_093121_create_payouts_table', 23),
(34, '2023_09_21_085103_create_wallets_table', 24),
(35, '2023_10_01_125109_create_pages_table', 25),
(36, '2023_10_02_162152_create_page_details_table', 26),
(37, '2023_10_04_102054_create_maintenance_modes_table', 27),
(38, '2023_10_05_124404_create_email_templates_table', 28),
(39, '2023_10_05_124445_create_notify_templates_table', 28),
(40, '2023_10_05_132313_create_email_sms_templates_table', 29),
(41, '2023_10_05_145420_create_push_notification_templates_table', 30),
(42, '2023_10_05_150447_create_in_app_notification_templates_table', 31),
(43, '2023_10_05_150641_create_notification_templates_table', 32),
(44, '2023_10_19_181838_create_jobs_table', 32),
(45, '2023_10_29_143424_create_senders_table', 33),
(46, '2023_10_30_181352_create_contact_types_table', 34),
(47, '2023_10_31_113635_create_contacts_table', 35),
(48, '2023_11_01_112506_create_custom_fields_table', 36),
(49, '2023_11_01_153424_create_notifications_table', 37),
(50, '2023_11_02_154916_create_unsubscribe_groups_table', 38),
(51, '2023_11_02_155754_create_unsubscribe_clients_table', 39),
(52, '2023_11_07_150746_create_segments_table', 40),
(53, '2023_11_07_152510_create_segment_emails_table', 41),
(54, '2023_11_09_172943_create_email_templates_table', 42),
(55, '2023_11_11_144946_create_single_sends_table', 43),
(56, '2023_11_16_103531_create_single_send_activities_table', 44),
(57, '2023_11_19_143605_create_automations_table', 45),
(58, '2023_11_21_115103_create_automation_schedules_table', 46),
(59, '2023_11_25_174813_create_email_automation_maps_table', 47),
(60, '2023_12_10_130202_create_user_activities_table', 48),
(61, '2023_12_10_183317_create_api_clients_table', 49),
(62, '2023_12_21_202251_create_prepaid_plans_table', 50),
(63, '2023_12_23_103800_create_plans_table', 51),
(64, '2023_12_23_173235_create_subscription_purchases_table', 52),
(65, '2020_07_07_055656_create_countries_table', 53),
(66, '2020_07_07_055725_create_cities_table', 53),
(67, '2020_07_07_055746_create_timezones_table', 53),
(68, '2021_10_19_071730_create_states_table', 53),
(69, '2021_10_23_082414_create_currencies_table', 53),
(70, '2022_01_22_034939_create_languages_table', 54),
(71, '2024_01_31_184327_create_announcements_table', 55),
(72, '2024_02_19_105920_create_crypto_currencies_table', 56),
(73, '2024_02_22_105020_create_fiat_currencies_table', 57),
(74, '2024_02_24_103536_create_coin_announces_table', 58),
(75, '2024_02_24_183756_create_crypto_methods_table', 59),
(76, '2024_02_27_114847_create_exchange_requests_table', 60),
(77, '2024_03_03_111217_create_buy_requests_table', 61),
(78, '2024_03_13_173029_create_fiat_send_gateways_table', 62),
(79, '2024_03_14_145003_create_sell_requests_table', 63);

-- --------------------------------------------------------

--
-- Table structure for table `notification_templates`
--

CREATE TABLE `notification_templates` (
  `id` int(11) UNSIGNED NOT NULL,
  `language_id` int(11) UNSIGNED NOT NULL,
  `name` varchar(191) DEFAULT NULL,
  `template_key` varchar(191) DEFAULT NULL,
  `email_from` varchar(191) DEFAULT NULL,
  `subject` text DEFAULT NULL,
  `short_keys` text DEFAULT NULL,
  `email` text DEFAULT NULL,
  `sms` text DEFAULT NULL,
  `in_app` text DEFAULT NULL,
  `push` text DEFAULT NULL,
  `status` varchar(191) DEFAULT NULL COMMENT 'mail = 0(inactive), mail = 1(active),\r\nsms = 0(inactive), sms = 1(active),\r\nin_app = 0(inactive), in_app = 1(active),\r\npush = 0(inactive), push = 1(active),\r\n ',
  `notify_for` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 => user, 1 => admin',
  `lang_code` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `notification_templates`
--

INSERT INTO `notification_templates` (`id`, `language_id`, `name`, `template_key`, `email_from`, `subject`, `short_keys`, `email`, `sms`, `in_app`, `push`, `status`, `notify_for`, `lang_code`, `created_at`, `updated_at`) VALUES
(10, 1, 'Two Step Disabled', 'TWO_STEP_DISABLED', 'support@you.com', NULL, '{\"action\":\"Enabled Or Disable\",\"ip\":\"Device Ip\",\"browser\":\"browser and Operating System \",\"time\":\"Time\"}', 'Google two factor verification is disabled', 'Google two factor verification is disabled', 'Google two factor verification is disabled', 'Google two factor verification is disabled', '{\"mail\":\"1\",\"sms\":\"0\",\"in_app\":\"0\",\"push\":\"0\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(11, 1, 'Support Ticket Create', 'SUPPORT_TICKET_CREATE', 'support@you.com', 'Support Ticket New', '{\"ticket_id\":\"Support Ticket ID\",\"username\":\"username\"}', '[[username]] create a ticket\r\nTicket : [[ticket_id]]', '[[username]] create a ticket\r\nTicket : [[ticket_id]]', '[[username]] create a ticket\r\nTicket : [[ticket_id]]', '[[username]] create a ticket\r\nTicket : [[ticket_id]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(12, 1, 'Support Ticket Replied', 'SUPPORT_TICKET_REPLIED', 'support@you.com', 'Support Ticket Replied', '{\"ticket_id\":\"Support Ticket ID\",\"username\":\"username\"}', '[[username]] replied  ticket\r\nTicket : [[ticket_id]]', '[[username]] replied  ticket\r\nTicket : [[ticket_id]]', '[[username]] replied  ticket\r\nTicket : [[ticket_id]]', '[[username]] replied  ticket\r\nTicket : [[ticket_id]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(13, 1, 'Admin Replied Support Ticket', 'ADMIN_REPLIED_TICKET', 'support@you.com', 'Support Ticket Replied', '{\"ticket_id\":\"Support Ticket ID\",\"ticket_subject\":\"Ticket Subject\",\"reply\":\"Reply Message\"}', 'Admin replied subject: [[ticket_subject]] message: [[reply]]\r\nTicket : [[ticket_id]]', 'Admin replied subject: [[ticket_subject]] message: [[reply]] \r\nTicket : [[ticket_id]]', 'Admin replied  \r\nTicket : [[ticket_id]]', 'Admin replied  \r\nTicket : [[ticket_id]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(15, 1, 'Two Step Enabled', 'TWO_STEP_ENABLED', 'support@you.com', 'TWO STEP ENABLED', '{\"action\":\"Enabled Or Disable\",\"ip\":\"Device Ip\",\"browser\":\"browser and Operating System \",\"time\":\"Time\",\"code\":\"code\"}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', '{\"mail\":\"1\",\"sms\":\"0\",\"in_app\":\"0\",\"push\":\"0\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(16, 1, 'User Make Payment', 'USER_MAKE_PAYMENT', 'support@you.com', 'Payment Successfully Completed', '{\"amount\":\"Amount\",\"currency\":\"Currency\",\"transaction\":\"Transaction Number\"}', '[[amount]] [[currency]] payment has been completed. Transaction [[transaction]]', '[[amount]] [[currency]] payment has been completed. Transaction [[transaction]]', '[[amount]] [[currency]] payment has been completed. Transaction [[transaction]]', '[[amount]] [[currency]] payment has been completed. Transaction [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(17, 1, 'User Make Payment Admin', 'USER_MAKE_PAYMENT_ADMIN', 'support@you.com', 'Make a Payment', '{\"user\":\"User\",\"amount\":\"Amount\",\"currency\":\"Currency\",\"transaction\":\"Transaction Number\"}', '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]', '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]', '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]', '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(18, 1, 'Payment Approved', 'PAYMENT_APPROVED', 'support@you.com', 'Payment Approved', '{\"amount\":\"amount\",\"feedback\":\"Admin feedback\",\"charge\":\"Payment Charge\",\"transaction\":\"Transaction Id\",\"gateway_name\":\"Gateway Name\"}', '[[username]] deposit request [[amount]] via [[gateway]] has been approved', '[[username]] deposit request [[amount]] via [[gateway]] has been approved', '[[username]] deposit request [[amount]] via [[gateway]] has been approved', '[[username]] deposit request [[amount]] via [[gateway]] has been approved', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(19, 1, 'Payment Rejected', 'PAYMENT_REJECTED', 'support@you.com', 'Payment Rejected', '{\"amount\":\"amount\",\"feedback\":\"Admin feedback\",\"charge\",\"Payment Charge\",\"gateway_name\":\"Gateway Name\",\"transaction\":\"Transaction Id\"}', '[[username]] deposit request [[amount]] via [[gateway]] payment rejected', '[[username]] deposit request [[amount]] via [[gateway]] payment rejected', '[[username]] deposit request [[amount]] via [[gateway]] payment rejected', '[[username]] deposit request [[amount]] via [[gateway]] payment rejected', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(20, 1, 'KYC Approved', 'KYC_APPROVED', 'support@you.com', 'KYC Approved', '{\"username\":\"Username\"}', '[[username]] your kyc has been approved', '[[username]] your kyc has been approved', '[[username]] your kyc has been approved', '[[username]] your kyc has been approved', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(21, 1, 'KYC Rejected', 'KYC_REJECTED', 'support@you.com', 'KYC Rejected', '{\"username\":\"Username\"}', '[[username]] your kyc has been rejected', '[[username]] your kyc has been rejected', '[[username]] your kyc has been rejected', '[[username]] your kyc has been rejected', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(22, 1, 'Verification Code', 'VERIFICATION_CODE', 'support@you.com', 'verify your email', '{\"code\":\"code\"}', 'Your email verification code [[code]]', 'Your sms verification code [[code]]', NULL, NULL, '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"0\",\"push\":\"0\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(23, 1, 'TWO STEP ENABLED', 'TWO_STEP_ENABLED', 'support@you.com', 'TWO STEP ENABLED', '{\"action\":\"Enabled Or Disable\",\"ip\":\"Device Ip\",\"browser\":\"browser and Operating System \",\"time\":\"Time\",\"code\":\"code\"}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', 'Your verification code is: {{code}}', '{\"mail\":\"1\",\"sms\":\"0\",\"in_app\":\"0\",\"push\":\"0\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(24, 1, 'TWO STEP DISABLED', 'TWO_STEP_DISABLED', 'support@you.com', NULL, '{\"action\":\"Enabled Or Disable\",\"ip\":\"Device Ip\",\"browser\":\"browser and Operating System \",\"time\":\"Time\"}', 'Google two factor verification is disabled', 'Google two factor verification is disabled', 'Google two factor verification is disabled', 'Google two factor verification is disabled', '{\"mail\":\"1\",\"sms\":\"0\",\"in_app\":\"0\",\"push\":\"0\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(25, 1, 'Exchange Request', 'EXCHANGE_REQUEST', 'support@you.com', 'You have a exchange request', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(26, 1, 'Buy Request', 'BUY_REQUEST', 'support@you.com', 'You have a buy request', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(27, 1, 'Sell Request', 'SELL_REQUEST', 'support@you.com', 'You have a sell request', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 1, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(28, 1, 'Exchange Complete', 'EXCHANGE_COMPLETE', 'support@you.com', 'Your exchange has been complete', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(29, 1, 'Exchange Cancel', 'EXCHANGE_CANCEL', 'support@you.com', 'Your exchange has been cancel', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(31, 1, 'Crypto Buy Complete', 'BUY_COMPLETE', 'support@you.com', 'Your crypto buy request has been complete', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(32, 1, 'Crypto Buy Cancel', 'BUY_CANCEL', 'support@you.com', 'Your crypto buy request has been cancel', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(34, 1, 'Crypto Sell Complete', 'SELL_COMPLETE', 'support@you.com', 'Your crypto sell request has been complete', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been completed. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),
(35, 1, 'Crypto Sell Cancel', 'SELL_CANCEL', 'support@you.com', 'Your crypto sell request has been cancel', '{\"user\":\"User\",\"sendAmount\":\"Send Amount\",\"getAmount\":\"Get Amount\",\"sendCurrency\":\"Send Currency\",\"getCurrency\":\"Get Currency\",\"transaction\":\"Transaction\"}', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '[[user]] your crypto sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]] has been cancel. Transaction Id- [[transaction]]', '{\"mail\":\"1\",\"sms\":\"1\",\"in_app\":\"1\",\"push\":\"1\"}', 0, 'en', '2021-08-02 18:05:43', '2024-01-21 10:40:05'),

-- --------------------------------------------------------

--
-- Table structure for table `pages`
--

CREATE TABLE `pages` (
  `id` int(11) UNSIGNED NOT NULL,
  `name` varchar(191) DEFAULT NULL,
  `slug` varchar(191) DEFAULT NULL,
  `template_name` varchar(191) DEFAULT NULL,
  `custom_link` varchar(191) DEFAULT NULL,
  `page_title` varchar(191) DEFAULT NULL,
  `meta_title` varchar(191) DEFAULT NULL,
  `meta_keywords` text DEFAULT NULL,
  `meta_description` text DEFAULT NULL,
  `og_description` text DEFAULT NULL,
  `meta_robots` text DEFAULT NULL,
  `meta_image` varchar(191) DEFAULT NULL,
  `meta_image_driver` varchar(50) DEFAULT NULL,
  `breadcrumb_image` varchar(191) DEFAULT NULL,
  `breadcrumb_image_driver` varchar(50) DEFAULT NULL,
  `breadcrumb_status` tinyint(1) DEFAULT 1 COMMENT '0 => inactive, 1 => active',
  `status` tinyint(1) DEFAULT 1 COMMENT '0 => unpublish, 1 => publish',
  `type` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 => admin create, 1 => developer create, 3= custom link',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `pages`
--

INSERT INTO `pages` (`id`, `name`, `slug`, `template_name`, `custom_link`, `page_title`, `meta_title`, `meta_keywords`, `meta_description`, `og_description`, `meta_robots`, `meta_image`, `meta_image_driver`, `breadcrumb_image`, `breadcrumb_image_driver`, `breadcrumb_status`, `status`, `type`, `created_at`, `updated_at`) VALUES
(1, 'gogar', '/', 'light', NULL, 'Home', 'Coinectra: Crypto Exchange Script for Easy Coin Swaps and Fiat Support', '[\"crypto exchange script\",\"cryptocurrency marketplace script\",\"changelly clone script\",\"crypto trading platform script\",\"blockchain exchange script\",\"fiat to crypto integration\",\"token swap platform\",\"cryptocurrency swapping tool\",\"blockchain business script\",\"crypto business software\",\"decentralized exchange script\",\"instant crypto swap script\",\"cryptocurrency trading software\",\"blockchain script for startups\",\"fiat crypto exchange solution\",\"crypto wallet integration\",\"blockchain API script\",\"multi-currency exchange platform\",\"ready-made crypto script\"]', 'Launch your own cryptocurrency exchange platform like Changelly with Coinectra. Our script offers instant coin swaps, fiat integration, and an easy-to-use interface.', 'Launch your own cryptocurrency exchange platform like Changelly with Coinectra. Our script offers instant coin swaps, fiat integration, and an easy-to-use interface.', 'index,follow', '/5X4WakXEU0UboIzL1v70lE4JXBnetA.webp', 'local', 'pagesImage/nV49kOF1BAL6QLOXM2yKpVaxSMaTzQ.webp', 'local', 0, 1, 0, '2024-11-11 05:01:38', '2024-11-18 03:59:14'),
(2, 'about', 'about', 'light', NULL, 'About', 'About', '[\"crypto exchange script\",\"cryptocurrency marketplace script\",\"changelly clone script\",\"crypto trading platform script\",\"blockchain exchange script\",\"fiat to crypto integration\",\"token swap platform\",\"cryptocurrency swapping tool\",\"blockchain business script\",\"crypto business software\",\"decentralized exchange script\",\"instant crypto swap script\",\"cryptocurrency trading software\",\"blockchain script for startups\",\"fiat crypto exchange solution\",\"crypto wallet integration\",\"blockchain API script\",\"multi-currency exchange platform\",\"ready-made crypto script\"]', 'Discover seamless crypto exchanges at our platform. Trade with confidence, benefit from low fees, and explore a wide range of digital assets. Your gateway to a secure and efficient cryptocurrency trading experience awaits. Join us now!', NULL, NULL, NULL, NULL, 'pagesImage/n4fzb2wu6GmX0lwEp5iQVPPUmyt250.webp', 'local', 1, 1, 0, '2024-11-13 18:25:16', '2024-11-13 18:25:16'),
(3, 'feature', 'feature', 'light', NULL, 'Feature', 'Feature', '[\"Feature\"]', 'Discover seamless crypto exchanges at our platform. Trade with confidence, benefit from low fees, and explore a wide range of digital assets. Your gateway to a secure and efficient cryptocurrency trading experience awaits. Join us now!', NULL, NULL, NULL, NULL, 'pagesImage/w6SMuaqCshDfFcxoK55mXf7YKJgCbP.webp', 'local', 1, 1, 0, '2024-11-03 04:42:46', '2024-11-03 04:42:46'),
(4, 'blog', 'blog', 'light', NULL, 'Blog', 'Blog', '[\"Blog\"]', 'Discover seamless crypto exchanges at our platform. Trade with confidence, benefit from low fees, and explore a wide range of digital assets. Your gateway to a secure and efficient cryptocurrency trading experience awaits. Join us now!', NULL, NULL, NULL, NULL, 'pagesImage/0dw5HcmK6KQztiFGWcK5EtLeLiM48w.webp', 'local', 1, 1, 0, '2024-11-06 20:58:26', '2024-11-06 20:58:26'),
(5, 'faq', 'faq', 'light', NULL, 'FAQ', 'FAQ', '[\"FAQ\"]', 'FAQ meta description', NULL, NULL, NULL, NULL, 'pagesImage/4RH7cKAlXovQxXBBECwmnsHvUS3YCl.webp', 'local', 1, 1, 0, '2024-11-13 12:18:51', '2024-11-13 12:18:51'),
(6, 'contact', 'contact', 'light', NULL, 'Contact', 'Contact', '[\"Contact\"]', 'Discover seamless crypto exchanges at our platform. Trade with confidence, benefit from low fees, and explore a wide range of digital assets. Your gateway to a secure and efficient cryptocurrency trading experience awaits. Join us now!', NULL, NULL, NULL, NULL, 'pagesImage/tWgerclslcL6uch8Wo9pKAxwta4C4J.webp', 'local', 1, 1, 0, '2024-11-02 19:28:05', '2024-11-02 19:28:05'),
(7, 'terms and conditions', 'terms-and-conditions', 'light', NULL, 'Terms and Condition', 'Terms and Condition', '[\"Terms and Condition\"]', 'Terms and Condition meta description', NULL, NULL, NULL, NULL, 'pagesImage/5TzAH8PK0J0XoiSVzDUUsqKwXKy0XX.webp', 'local', 1, 1, 0, '2024-11-01 23:16:01', '2024-11-01 23:16:01'),
(8, 'privacy policy', 'privacy-policy', 'light', NULL, 'Privacy Policy', 'Privacy Policy', '[\"Privacy Policy\"]', 'Privacy Policy meta description', NULL, NULL, NULL, NULL, 'pagesImage/Fs9A5g7qnbovaqJbY9MmovuqbI08bd.webp', 'local', 1, 1, 0, '2024-10-31 18:44:56', '2024-10-31 18:44:56');

-- --------------------------------------------------------

--
-- Table structure for table `page_details`
--

CREATE TABLE `page_details` (
  `id` int(11) UNSIGNED NOT NULL,
  `page_id` int(11) DEFAULT NULL,
  `language_id` int(11) DEFAULT NULL,
  `name` varchar(191) DEFAULT NULL,
  `content` longtext DEFAULT NULL,
  `sections` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `page_details`
--

INSERT INTO `page_details` (`id`, `page_id`, `language_id`, `name`, `content`, `sections`, `created_at`, `updated_at`) VALUES
(1, 1, 1, 'Home', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[hero]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[about]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[feature]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[how_it_work]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[why_choose_us]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[faq]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[testimonial]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[blog]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[subscribe]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"hero\",\"about\",\"feature\",\"how_it_work\",\"why_choose_us\",\"faq\",\"testimonial\",\"blog\",\"subscribe\"]', '2024-11-16 10:32:21', '2024-11-16 10:32:21'),
(3, 2, 1, 'About', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[about]]</div>\n                    <span class=\"delete-block\">×</span>\n                    <span class=\"up-block\">↑</span>\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[feature]]</div>\n                    <span class=\"delete-block\">×</span>\n                    <span class=\"up-block\">↑</span>\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[faq]]</div>\n                    <span class=\"delete-block\">×</span>\n                    <span class=\"up-block\">↑</span>\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[testimonial]]</div>\n                    <span class=\"delete-block\">×</span>\n                    <span class=\"up-block\">↑</span>\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"about\",\"feature\",\"faq\",\"testimonial\"]', '2024-11-06 22:25:08', '2024-11-06 22:25:08'),
(4, 3, 1, 'Feature', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[feature]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[why_choose_us]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[subscribe]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"feature\",\"why_choose_us\",\"subscribe\"]', '2024-11-01 18:50:50', '2024-11-01 18:50:50'),
(5, 4, 1, 'Blog', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[blog]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[subscribe]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"blog\",\"subscribe\"]', '2024-11-17 04:33:10', '2024-11-17 04:33:10'),
(6, 5, 1, 'FAQ', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[faq]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[why_choose_us]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"faq\",\"why_choose_us\"]', '2024-11-06 02:28:06', '2024-11-06 02:28:06'),
(7, 6, 1, 'Contact', '<div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[contact]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p><div class=\"custom-block\" contenteditable=\"false\"><div class=\"custom-block-content\">[[subscribe]]</div>\r\n                    <span class=\"delete-block\">×</span>\r\n                    <span class=\"up-block\">↑</span>\r\n                    <span class=\"down-block\">↓</span></div><p><br></p>', '[\"contact\",\"subscribe\"]', '2024-11-06 05:11:37', '2024-11-06 05:11:37'),
(8, 7, 1, 'Terms and conditions', '<h3>Our Terms &amp; Conditions</h3><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and share your personal information when you visit or make a purchase from our website.</p><p><br><br></p><h5>Personal Information We Collect</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">When you visit our website, we collect certain information about your device, including your IP address, browser type, and operating system. We also collect information about the pages you visit on our website, the links you click, and the products you view or purchase. We collect this information using cookies and other tracking technologies. For more information about cookies, please see the \"Cookies\" section below.</p><p><br><br></p><h5>How We Use Your Personal Information</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We use the information we collect from you to:</p><ul><li>Process your orders and fulfill your requests</li><li>Communicate with you about your orders, products, and services</li><li>Provide you with targeted advertising and marketing</li><li>Improve our website and products</li><li>Comply with applicable laws and regulations</li></ul><p><br><br></p><h5>Sharing Your Personal Information</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We share your personal information with third parties to help us with the purposes listed above. For example, we use Shopify to power our online store. You can read more about how Shopify uses your personal information here: https://www.shopify.com/legal/privacy. We also use Google Analytics to track website traffic. You can read more about how Google uses your personal information You can opt-out of Google Analytics tracking. Finally, we may share your personal information to comply with applicable laws and regulations, to respond to a subpoena, search warrant or other lawful request for information we receive, or to protect our rights.</p><p><br><br></p><h5>Contact Us</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">If you have any questions about this Privacy Policy, please contact us at [email protected]</p>', NULL, '2024-11-14 20:07:47', '2024-11-14 20:07:47'),
(9, 8, 1, 'Privacy policy', '<h3>Our Privacy Policy</h3><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and share your personal information when you visit or make a purchase from our website.</p><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\"><br></p><h5>Personal Information We Collect</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">When you visit our website, we collect certain information about your device, including your IP address, browser type, and operating system. We also collect information about the pages you visit on our website, the links you click, and the products you view or purchase. We collect this information using cookies and other tracking technologies. For more information about cookies, please see the \"Cookies\" section below.</p><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\"><br></p><h5>How We Use Your Personal Information</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We use the information we collect from you to:</p><ul><li>Process your orders and fulfill your requests</li><li>Communicate with you about your orders, products, and services</li><li>Provide you with targeted advertising and marketing</li><li>Improve our website and products</li><li>Comply with applicable laws and regulations</li></ul><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\"><br><br></p><h5>Sharing Your Personal Information</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">We share your personal information with third parties to help us with the purposes listed above. For example, we use Shopify to power our online store. You can read more about how Shopify uses your personal information here: https://www.shopify.com/legal/privacy. We also use Google Analytics to track website traffic. You can read more about how Google uses your personal information You can opt-out of Google Analytics tracking. Finally, we may share your personal information to comply with applicable laws and regulations, to respond to a subpoena, search warrant or other lawful request for information we receive, or to protect our rights.</p><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\"><br><br></p><h5>Contact Us</h5><p style=\"color:rgb(105,105,105);font-family:\'DM Sans\', sans-serif;font-size:15px;\">If you have any questions about this Privacy Policy, please contact us at [email protected]</p>', NULL, '2024-11-07 15:16:48', '2024-11-07 15:16:48');

-- --------------------------------------------------------

--
-- Table structure for table `password_resets`
--

CREATE TABLE `password_resets` (
  `email` varchar(191) NOT NULL,
  `token` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `password_reset_tokens`
--

CREATE TABLE `password_reset_tokens` (
  `email` varchar(191) NOT NULL,
  `token` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `personal_access_tokens`
--

CREATE TABLE `personal_access_tokens` (
  `id` int(11) UNSIGNED NOT NULL,
  `tokenable_type` varchar(191) NOT NULL,
  `tokenable_id` int(11) UNSIGNED NOT NULL,
  `name` varchar(191) NOT NULL,
  `token` varchar(64) NOT NULL,
  `abilities` text DEFAULT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sell_requests`
--

CREATE TABLE `sell_requests` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `send_currency_id` bigint(20) UNSIGNED NOT NULL,
  `get_currency_id` bigint(20) UNSIGNED NOT NULL,
  `fiat_send_gateway_id` bigint(20) UNSIGNED DEFAULT NULL,
  `crypto_method_id` bigint(20) UNSIGNED DEFAULT NULL,
  `send_amount` decimal(18,8) NOT NULL DEFAULT 0.00000000,
  `get_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `exchange_rate` double(8,2) NOT NULL DEFAULT 1.00 COMMENT '1 sendCurrency = buyCurrency',
  `processing_fee` double(8,2) NOT NULL DEFAULT 0.00,
  `final_amount` double(8,2) NOT NULL DEFAULT 0.00 COMMENT 'After deduct all fees',
  `parameters` text DEFAULT NULL COMMENT 'information for send fiat',
  `utr` varchar(255) DEFAULT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0=>initiate,1=>give_address,2=>deposit_amount,3=>exchange_completed,5=>cancel',
  `admin_wallet` text DEFAULT NULL COMMENT 'admin crypto wallet address',
  `expire_time` timestamp NULL DEFAULT NULL COMMENT 'crypto send expire time',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `subscribes`
--

CREATE TABLE `subscribes` (
  `id` int(11) UNSIGNED NOT NULL,
  `email` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_tickets`
--

CREATE TABLE `support_tickets` (
  `id` int(11) UNSIGNED NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `ticket` varchar(191) DEFAULT NULL,
  `subject` varchar(191) DEFAULT NULL,
  `status` tinyint(1) DEFAULT 0 COMMENT '0 =>  Open, 1 => Answered, 2 => Replied, 3 => Closed',
  `last_reply` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_attachments`
--

CREATE TABLE `support_ticket_attachments` (
  `id` int(11) UNSIGNED NOT NULL,
  `support_ticket_message_id` int(11) DEFAULT NULL,
  `file` varchar(191) DEFAULT NULL,
  `driver` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_messages`
--

CREATE TABLE `support_ticket_messages` (
  `id` int(11) UNSIGNED NOT NULL,
  `support_ticket_id` int(11) DEFAULT NULL,
  `admin_id` int(11) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int(11) UNSIGNED NOT NULL,
  `transactional_id` int(11) DEFAULT NULL,
  `transactional_type` varchar(100) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `amount` double(11,2) DEFAULT NULL COMMENT 'in base currency',
  `transaction_amount` decimal(18,8) DEFAULT NULL COMMENT 'the transactional amount',
  `transaction_currency` varchar(5) DEFAULT NULL COMMENT 'transactional currency',
  `balance` varchar(20) DEFAULT NULL,
  `charge` decimal(11,2) NOT NULL DEFAULT 0.00 COMMENT 'in base currency',
  `trx_type` varchar(10) DEFAULT NULL,
  `remarks` varchar(191) NOT NULL,
  `trx_id` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) UNSIGNED NOT NULL,
  `firstname` varchar(191) DEFAULT NULL,
  `lastname` varchar(191) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `referral_id` int(11) DEFAULT NULL,
  `language_id` int(11) DEFAULT NULL,
  `email` varchar(191) DEFAULT NULL,
  `country_code` varchar(20) DEFAULT NULL,
  `country` varchar(191) DEFAULT NULL,
  `phone_code` varchar(20) DEFAULT NULL,
  `phone` varchar(191) DEFAULT NULL,
  `document_number` varchar(191) DEFAULT NULL,
  `balance` decimal(11,2) DEFAULT 0.00,
  `image` varchar(191) DEFAULT NULL,
  `image_driver` varchar(50) DEFAULT NULL,
  `state` varchar(191) DEFAULT NULL,
  `city` varchar(191) DEFAULT NULL,
  `zip_code` varchar(191) DEFAULT NULL COMMENT 'Zip Or Postal Code',
  `address` text DEFAULT NULL,
  `address_two` text DEFAULT NULL,
  `provider` varchar(191) DEFAULT NULL,
  `provider_id` varchar(191) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `identity_verify` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0 => Not Applied, 1=> Applied, 2=> Approved, 3 => Rejected	',
  `address_verify` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0 => Not Applied, 1=> Applied, 2=> Approved, 3 => Rejected	',
  `two_fa` tinyint(1) NOT NULL DEFAULT 0,
  `two_fa_verify` tinyint(1) NOT NULL DEFAULT 1,
  `two_fa_code` varchar(50) DEFAULT NULL,
  `email_verification` tinyint(1) NOT NULL DEFAULT 1,
  `sms_verification` tinyint(1) NOT NULL DEFAULT 1,
  `verify_code` varchar(50) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `last_seen` datetime DEFAULT NULL,
  `time_zone` varchar(191) DEFAULT NULL,
  `password` varchar(191) DEFAULT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `email_key` text DEFAULT NULL,
  `sms_key` text DEFAULT NULL,
  `push_key` text DEFAULT NULL,
  `in_app_key` text DEFAULT NULL,
  `public_key` varchar(191) DEFAULT NULL COMMENT 'for api intregation',
  `secret_key` varchar(191) DEFAULT NULL COMMENT 'for api intregation',
  `webhook_url` text DEFAULT NULL COMMENT 'mail report send in this url',
  `github_id` varchar(191) DEFAULT NULL,
  `google_id` varchar(191) DEFAULT NULL,
  `facebook_id` varchar(191) DEFAULT NULL,
  `fcm_token` text DEFAULT NULL,
  `timezone` varchar(191) DEFAULT NULL,
  `use_contacts` int(11) NOT NULL DEFAULT 0 COMMENT 'contact add so far',
  `use_emails` int(11) NOT NULL DEFAULT 0 COMMENT 'email send so far',
  `limit_contact` int(11) NOT NULL DEFAULT 0 COMMENT 'contact add limit',
  `limit_emails` int(11) NOT NULL DEFAULT 0 COMMENT 'email send limit',
  `subs_expired_at` timestamp NULL DEFAULT NULL,
  `plan_id` int(11) DEFAULT NULL COMMENT 'running purchase plan id'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_kycs`
--

CREATE TABLE `user_kycs` (
  `id` int(11) UNSIGNED NOT NULL,
  `user_id` int(11) UNSIGNED DEFAULT NULL,
  `kyc_id` int(11) DEFAULT NULL,
  `kyc_type` varchar(191) DEFAULT NULL,
  `kyc_info` text DEFAULT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 0 COMMENT '0=>pending , 1=> verified, 2=>rejected',
  `reason` longtext DEFAULT NULL COMMENT 'rejected reason',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_logins`
--

CREATE TABLE `user_logins` (
  `id` int(11) UNSIGNED NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `longitude` varchar(191) DEFAULT NULL,
  `latitude` varchar(191) DEFAULT NULL,
  `country_code` varchar(50) DEFAULT NULL,
  `location` varchar(191) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `ip_address` varchar(100) DEFAULT NULL,
  `browser` varchar(191) DEFAULT NULL,
  `os` varchar(191) DEFAULT NULL,
  `get_device` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `admins_username_unique` (`username`),
  ADD UNIQUE KEY `admins_email_unique` (`email`);

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `basic_controls`
--
ALTER TABLE `basic_controls`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `buy_requests`
--
ALTER TABLE `buy_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `buy_requests_user_id_index` (`user_id`),
  ADD KEY `buy_requests_send_currency_id_index` (`send_currency_id`),
  ADD KEY `buy_requests_get_currency_id_index` (`get_currency_id`);

--
-- Indexes for table `coin_announces`
--
ALTER TABLE `coin_announces`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `contents`
--
ALTER TABLE `contents`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `content_details`
--
ALTER TABLE `content_details`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `crypto_currencies`
--
ALTER TABLE `crypto_currencies`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `crypto_methods`
--
ALTER TABLE `crypto_methods`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `deposits`
--
ALTER TABLE `deposits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `deposits_user_id_foreign` (`user_id`),
  ADD KEY `deposits_payment_method_id_foreign` (`payment_method_id`);

--
-- Indexes for table `exchange_requests`
--
ALTER TABLE `exchange_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `exchange_requests_user_id_index` (`user_id`),
  ADD KEY `exchange_requests_send_currency_id_index` (`send_currency_id`),
  ADD KEY `exchange_requests_get_currency_id_index` (`get_currency_id`);

--
-- Indexes for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `failed_jobs_uuid_unique` (`uuid`);

--
-- Indexes for table `fiat_currencies`
--
ALTER TABLE `fiat_currencies`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fiat_currencies_buy_gateway_id_foreign` (`buy_gateway_id`),
  ADD KEY `fiat_currencies_fiat_send_gateway_id_foreign` (`fiat_send_gateway_id`);

--
-- Indexes for table `fiat_send_gateways`
--
ALTER TABLE `fiat_send_gateways`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `file_storages`
--
ALTER TABLE `file_storages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `fire_base_tokens`
--
ALTER TABLE `fire_base_tokens`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `funds`
--
ALTER TABLE `funds`
  ADD PRIMARY KEY (`id`),
  ADD KEY `funds_user_id_foreign` (`user_id`),
  ADD KEY `funds_gateway_id_foreign` (`gateway_id`);

--
-- Indexes for table `gateways`
--
ALTER TABLE `gateways`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `gateways_code_unique` (`code`);

--
-- Indexes for table `in_app_notifications`
--
ALTER TABLE `in_app_notifications`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `jobs`
--
ALTER TABLE `jobs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `jobs_queue_index` (`queue`);

--
-- Indexes for table `kycs`
--
ALTER TABLE `kycs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `languages`
--
ALTER TABLE `languages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `maintenance_modes`
--
ALTER TABLE `maintenance_modes`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `manage_menus`
--
ALTER TABLE `manage_menus`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `manual_sms_configs`
--
ALTER TABLE `manual_sms_configs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `migrations`
--
ALTER TABLE `migrations`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `notification_templates`
--
ALTER TABLE `notification_templates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `notification_templates_language_id_foreign` (`language_id`);

--
-- Indexes for table `pages`
--
ALTER TABLE `pages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `page_details`
--
ALTER TABLE `page_details`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `password_resets`
--
ALTER TABLE `password_resets`
  ADD KEY `password_resets_email_index` (`email`);

--
-- Indexes for table `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`email`);

--
-- Indexes for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `personal_access_tokens_token_unique` (`token`),
  ADD KEY `personal_access_tokens_tokenable_type_tokenable_id_index` (`tokenable_type`,`tokenable_id`);

--
-- Indexes for table `sell_requests`
--
ALTER TABLE `sell_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `sell_requests_user_id_index` (`user_id`),
  ADD KEY `sell_requests_send_currency_id_index` (`send_currency_id`),
  ADD KEY `sell_requests_get_currency_id_index` (`get_currency_id`),
  ADD KEY `sell_requests_fiat_send_gateway_id_index` (`fiat_send_gateway_id`),
  ADD KEY `sell_requests_crypto_method_id_index` (`crypto_method_id`);

--
-- Indexes for table `subscribes`
--
ALTER TABLE `subscribes`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `support_ticket_attachments`
--
ALTER TABLE `support_ticket_attachments`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `support_ticket_messages`
--
ALTER TABLE `support_ticket_messages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_email_unique` (`email`);

--
-- Indexes for table `user_kycs`
--
ALTER TABLE `user_kycs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_kycs_user_id_index` (`user_id`);

--
-- Indexes for table `user_logins`
--
ALTER TABLE `user_logins`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admins`
--
ALTER TABLE `admins`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `basic_controls`
--
ALTER TABLE `basic_controls`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `buy_requests`
--
ALTER TABLE `buy_requests`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `coin_announces`
--
ALTER TABLE `coin_announces`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `contents`
--
ALTER TABLE `contents`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=90;

--
-- AUTO_INCREMENT for table `content_details`
--
ALTER TABLE `content_details`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=167;

--
-- AUTO_INCREMENT for table `crypto_currencies`
--
ALTER TABLE `crypto_currencies`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `crypto_methods`
--
ALTER TABLE `crypto_methods`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `deposits`
--
ALTER TABLE `deposits`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `exchange_requests`
--
ALTER TABLE `exchange_requests`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `fiat_currencies`
--
ALTER TABLE `fiat_currencies`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `fiat_send_gateways`
--
ALTER TABLE `fiat_send_gateways`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `file_storages`
--
ALTER TABLE `file_storages`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `fire_base_tokens`
--
ALTER TABLE `fire_base_tokens`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `funds`
--
ALTER TABLE `funds`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `gateways`
--
ALTER TABLE `gateways`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1008;

--
-- AUTO_INCREMENT for table `in_app_notifications`
--
ALTER TABLE `in_app_notifications`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `jobs`
--
ALTER TABLE `jobs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=167;

--
-- AUTO_INCREMENT for table `kycs`
--
ALTER TABLE `kycs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `languages`
--
ALTER TABLE `languages`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT for table `maintenance_modes`
--
ALTER TABLE `maintenance_modes`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `manage_menus`
--
ALTER TABLE `manage_menus`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `manual_sms_configs`
--
ALTER TABLE `manual_sms_configs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `migrations`
--
ALTER TABLE `migrations`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=80;

--
-- AUTO_INCREMENT for table `notification_templates`
--
ALTER TABLE `notification_templates`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=37;

--
-- AUTO_INCREMENT for table `pages`
--
ALTER TABLE `pages`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=45;

--
-- AUTO_INCREMENT for table `page_details`
--
ALTER TABLE `page_details`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=55;

--
-- AUTO_INCREMENT for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sell_requests`
--
ALTER TABLE `sell_requests`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `subscribes`
--
ALTER TABLE `subscribes`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_tickets`
--
ALTER TABLE `support_tickets`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_attachments`
--
ALTER TABLE `support_ticket_attachments`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_messages`
--
ALTER TABLE `support_ticket_messages`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_kycs`
--
ALTER TABLE `user_kycs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_logins`
--
ALTER TABLE `user_logins`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `notification_templates`
--
ALTER TABLE `notification_templates`
  ADD CONSTRAINT `notification_templates_language_id_foreign` FOREIGN KEY (`language_id`) REFERENCES `languages` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
